import {
  annotationFromRow,
  parseElements,
  type AnnotationElement,
} from '@/models/annotation.model';
import { annotationRow, ids, TECH_A, TECH_B, visitRow } from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import {
  ANNOTATION_BY_VISIT_SQL,
  INSERT_ANNOTATION_SQL,
  OWN_VISIT_SQL,
  UPDATE_ANNOTATION_SQL,
} from '../services/annotation.queries';
import { ANNOTATION_MESSAGES, saveAnnotation } from '../services/annotation.service';

/** Consultas y escrituras de anotaciones ejecutadas contra SQLite real. */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-10T12:00:00.000Z');
const LATER = new Date('2026-06-10T12:05:00.000Z');

const line = (id: string): AnnotationElement => ({
  id,
  type: 'line',
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.8, y: 0.9 },
  ],
  color: 0xffc62828,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
});

let db: TestDatabase;

beforeEach(() => {
  resetIds('anotacion');
  db = createTestDatabase();
  db.insert('visits', [
    visitRow({ id: 'v1', status: 'inProgress' }),
    visitRow({ id: 'v-cerrada', status: 'synced' }),
    visitRow({ id: 'v-ajena', technician_id: TECH_B, status: 'inProgress' }),
  ]);
});

describe('consultas de anotaciones', () => {
  it('ANNOTATION_BY_VISIT_SQL devuelve la más antigua de la visita', async () => {
    db.insert('annotations', [
      annotationRow({ id: 'a-nueva', created_at: '2026-06-05T00:00:00.000Z' }),
      annotationRow({ id: 'a-vieja', created_at: '2026-06-01T00:00:00.000Z' }),
      annotationRow({ id: 'a-otra', visit_id: 'v-cerrada' }),
    ]);
    expect(ids(await db.getAll<Row>(ANNOTATION_BY_VISIT_SQL, ['v1']))).toEqual(['a-vieja']);
    expect(await db.getAll(ANNOTATION_BY_VISIT_SQL, ['sin-anotacion'])).toEqual([]);
  });

  it('INSERT y UPDATE de la anotación', async () => {
    await db.execute(INSERT_ANNOTATION_SQL, [
      'a1',
      'v1',
      null,
      '[]',
      null,
      400.5,
      300,
      'pendingSync',
      'c',
      'c',
    ]);
    await db.execute(UPDATE_ANNOTATION_SQL, ['[1]', 500, 250, 'pendingSync', 'u', 'a1']);
    expect(db.rows('annotations')[0]).toMatchObject({
      elements: '[1]',
      canvas_width: 500,
      canvas_height: 250,
      updated_at: 'u',
      created_at: 'c',
    });
    expect(await db.getOptional(OWN_VISIT_SQL, ['v-ajena', TECH_A])).toBeNull();
  });
});

describe('saveAnnotation contra SQLite real', () => {
  it('el primer guardado crea la fila; los siguientes la actualizan (nunca dos filas)', async () => {
    const first = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', elements: [line('l1')], canvasWidth: 390, canvasHeight: 600 },
      NOW,
    );
    expect(first.ok).toBe(true);

    const second = await saveAnnotation(
      db,
      TECH_A,
      // El tamaño del canvas cambió (p. ej. al rotar): se conserva la referencia guardada.
      { visitId: 'v1', elements: [line('l1'), line('l2')], canvasWidth: 800, canvasHeight: 400 },
      LATER,
    );
    expect(second.ok).toBe(true);

    const rows = db.rows('annotations');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'anotacion-1',
      visit_id: 'v1',
      canvas_width: 390,
      canvas_height: 600,
      sync_status: 'pendingSync',
      created_at: NOW.toISOString(),
      updated_at: LATER.toISOString(),
    });
    const stored = annotationFromRow(await db.get<Row>(ANNOTATION_BY_VISIT_SQL, ['v1']));
    expect(stored.elements.map((element) => element.id)).toEqual(['l1', 'l2']);
    expect(parseElements(rows[0]?.elements)).toEqual([line('l1'), line('l2')]);
  });

  it('sin referencia previa guarda la del canvas actual (y descarta tamaños no válidos)', async () => {
    await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', elements: [], canvasWidth: 0, canvasHeight: null },
      NOW,
    );
    expect(db.rows('annotations')[0]).toMatchObject({ canvas_width: null, canvas_height: null });

    await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', elements: [], canvasWidth: 320, canvasHeight: 480 },
      LATER,
    );
    expect(db.rows('annotations')[0]).toMatchObject({ canvas_width: 320, canvas_height: 480 });
  });

  it('no escribe en visitas cerradas ni ajenas', async () => {
    const input = { elements: [line('l1')], canvasWidth: 10, canvasHeight: 10 };
    const closed = await saveAnnotation(db, TECH_A, { ...input, visitId: 'v-cerrada' }, NOW);
    expect(!closed.ok && closed.error.message).toBe(ANNOTATION_MESSAGES.visitClosed);
    const foreign = await saveAnnotation(db, TECH_A, { ...input, visitId: 'v-ajena' }, NOW);
    expect(!foreign.ok && foreign.error.message).toBe(ANNOTATION_MESSAGES.visitNotFound);
    expect(db.rows('annotations')).toEqual([]);
  });

  it('si el UPDATE falla en SQLite, la anotación guardada no cambia (ROLLBACK real)', async () => {
    await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', elements: [line('l1')], canvasWidth: 10, canvasHeight: 10 },
      NOW,
    );
    const before = db.rows('annotations');
    db.raw.exec(`CREATE TRIGGER fallo BEFORE UPDATE ON annotations
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);

    const result = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', elements: [], canvasWidth: 10, canvasHeight: 10 },
      LATER,
    );

    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('annotations')).toEqual(before);
  });
});
