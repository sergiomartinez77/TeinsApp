import {
  annotationFromRow,
  figureFromRow,
  parseElements,
  PLAN_NAME_MAX_LENGTH,
  type AnnotationElement,
} from '@/models/annotation.model';
import { annotationRow, figureRow, ids, TECH_A, TECH_B, visitRow } from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import {
  ANNOTATION_BY_ID_SQL,
  ANNOTATION_IN_VISIT_SQL,
  ANNOTATIONS_BY_VISIT_SQL,
  FIGURES_BY_TECHNICIAN_SQL,
  OWN_VISIT_SQL,
} from '../services/annotation.queries';
import {
  ANNOTATION_MESSAGES,
  cleanName,
  createAnnotation,
  deleteAnnotation,
  renameAnnotation,
  saveAnnotation,
} from '../services/annotation.service';
import {
  deleteFigure,
  FIGURE_MESSAGES,
  normalizeFigure,
  placeFigure,
  saveFigure,
} from '../services/figure.service';

/** Consultas y escrituras de planos y figuras ejecutadas contra SQLite real. */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-10T12:00:00.000Z');
const LATER = new Date('2026-06-10T12:05:00.000Z');

/** Línea en centímetros (formato 2). */
const line = (id: string, from = { x: 10, y: 20 }, to = { x: 80, y: 90 }): AnnotationElement => ({
  id,
  type: 'line',
  points: [from, to],
  color: 0xffc62828,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
});

const marker = (id: string, x: number, y: number): AnnotationElement => ({
  id,
  type: 'marker',
  points: [{ x, y }],
  color: 0xff000000,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
});

let db: TestDatabase;

const getPlan = async (id: string) =>
  annotationFromRow(await db.get<Row>(ANNOTATION_BY_ID_SQL, [id]));

beforeEach(() => {
  resetIds('plano');
  db = createTestDatabase();
  db.insert('visits', [
    visitRow({ id: 'v1', status: 'inProgress' }),
    visitRow({ id: 'v2', status: 'assigned' }),
    visitRow({ id: 'v-cerrada', status: 'completed' }),
    visitRow({ id: 'v-ajena', technician_id: TECH_B, status: 'inProgress' }),
  ]);
});

describe('consultas de planos', () => {
  it('ANNOTATIONS_BY_VISIT_SQL devuelve todos los planos de la visita, del más antiguo', async () => {
    db.insert('annotations', [
      annotationRow({ id: 'a-nuevo', created_at: '2026-06-05T00:00:00.000Z' }),
      annotationRow({ id: 'a-viejo', created_at: '2026-06-01T00:00:00.000Z' }),
      // Mismo instante: desempata el id.
      annotationRow({ id: 'a-b', created_at: '2026-06-03T00:00:00.000Z' }),
      annotationRow({ id: 'a-a', created_at: '2026-06-03T00:00:00.000Z' }),
      annotationRow({ id: 'a-otra', visit_id: 'v2' }),
    ]);

    expect(ids(await db.getAll<Row>(ANNOTATIONS_BY_VISIT_SQL, ['v1']))).toEqual([
      'a-viejo',
      'a-a',
      'a-b',
      'a-nuevo',
    ]);
    expect(ids(await db.getAll<Row>(ANNOTATIONS_BY_VISIT_SQL, ['v2']))).toEqual(['a-otra']);
    expect(await db.getAll(ANNOTATIONS_BY_VISIT_SQL, ['sin-planos'])).toEqual([]);
  });

  it('ANNOTATION_BY_ID_SQL e ANNOTATION_IN_VISIT_SQL', async () => {
    db.insert('annotations', [annotationRow({ id: 'a1', visit_id: 'v1', title: 'Sótano' })]);

    expect(await db.getOptional<Row>(ANNOTATION_BY_ID_SQL, ['a1'])).toMatchObject({
      id: 'a1',
      title: 'Sótano',
      format_version: 2,
    });
    expect(await db.getOptional(ANNOTATION_BY_ID_SQL, ['no-existe'])).toBeNull();
    expect(await db.getOptional(ANNOTATION_IN_VISIT_SQL, ['a1', 'v1'])).toEqual({ id: 'a1' });
    expect(await db.getOptional(ANNOTATION_IN_VISIT_SQL, ['a1', 'v2'])).toBeNull();
    expect(await db.getOptional(OWN_VISIT_SQL, ['v-ajena', TECH_A])).toBeNull();
  });
});

describe('createAnnotation', () => {
  it('crea un plano vacío en el formato 2 con el título limpio', async () => {
    const result = await createAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', title: '  Planta baja ' },
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(db.rows('annotations')).toEqual([
      {
        id: 'plano-1',
        visit_id: 'v1',
        title: 'Planta baja',
        elements: '[]',
        base_image_path: null,
        canvas_width: null,
        canvas_height: null,
        format_version: 2,
        sync_status: 'pendingSync',
        created_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
      },
    ]);
    expect(result.ok && result.data).toEqual(await getPlan('plano-1'));
  });

  it('una visita puede tener varios planos; sin título queda en null', async () => {
    await createAnnotation(db, TECH_A, { visitId: 'v1', title: '' }, NOW);
    await createAnnotation(db, TECH_A, { visitId: 'v1', title: '    ' }, LATER);

    const rows = await db.getAll<Row>(ANNOTATIONS_BY_VISIT_SQL, ['v1']);
    expect(ids(rows)).toEqual(['plano-1', 'plano-2']);
    expect(rows.map((row) => row.title)).toEqual([null, null]);
  });

  it(`recorta el título a ${PLAN_NAME_MAX_LENGTH} caracteres`, async () => {
    const result = await createAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', title: `${'a'.repeat(59)} ${'b'.repeat(10)}` },
      NOW,
    );

    // Corta en 60 y vuelve a quitar el espacio final.
    expect(result.ok && result.data.title).toBe('a'.repeat(59));
    expect(cleanName(` ${'x'.repeat(80)}`)).toHaveLength(PLAN_NAME_MAX_LENGTH);
  });

  it('no crea planos en visitas cerradas, ajenas o inexistentes', async () => {
    const closed = await createAnnotation(db, TECH_A, { visitId: 'v-cerrada', title: 'X' }, NOW);
    const foreign = await createAnnotation(db, TECH_A, { visitId: 'v-ajena', title: 'X' }, NOW);
    const missing = await createAnnotation(db, TECH_A, { visitId: 'no-existe', title: 'X' }, NOW);

    expect(closed).toMatchObject({
      ok: false,
      error: { message: ANNOTATION_MESSAGES.visitClosed, code: 'visit_closed' },
    });
    expect(foreign).toMatchObject({
      ok: false,
      error: { message: ANNOTATION_MESSAGES.visitNotFound, code: 'not_found' },
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(db.rows('annotations')).toEqual([]);
  });

  it('si el INSERT falla en SQLite devuelve un error de base de datos', async () => {
    db.raw.exec(`CREATE TRIGGER fallo BEFORE INSERT ON annotations
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);

    const result = await createAnnotation(db, TECH_A, { visitId: 'v1', title: 'X' }, NOW);

    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('annotations')).toEqual([]);
  });
});

describe('saveAnnotation', () => {
  beforeEach(() => {
    db.insert('annotations', [
      annotationRow({ id: 'a1', visit_id: 'v1', created_at: NOW.toISOString() }),
      annotationRow({ id: 'a2', visit_id: 'v1', elements: JSON.stringify([line('otro')]) }),
      annotationRow({ id: 'a-v2', visit_id: 'v2' }),
    ]);
  });

  it('guarda los elementos en la fila del plano (formato 2) y no toca los demás', async () => {
    const before = db.rows('annotations').filter((row) => row.id !== 'a1');
    const elements = [line('l1'), marker('m1', -250.123, 9000)];

    const result = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', annotationId: 'a1', elements },
      LATER,
    );

    expect(result.ok).toBe(true);
    const row = db.rows('annotations').find((item) => item.id === 'a1');
    expect(row).toMatchObject({
      format_version: 2,
      sync_status: 'pendingSync',
      created_at: NOW.toISOString(),
      updated_at: LATER.toISOString(),
    });
    // Coordenadas con 2 decimales y sin recortar.
    const stored = parseElements(row?.elements);
    expect(stored).toEqual([line('l1'), marker('m1', -250.12, 9000)]);
    expect(result.ok && result.data.elements).toEqual(stored);
    expect(db.rows('annotations').filter((item) => item.id !== 'a1')).toEqual(before);
  });

  it('un plano antiguo (formato 1) pasa al formato 2 al guardarlo', async () => {
    db.insert('annotations', [
      annotationRow({
        id: 'a-viejo',
        visit_id: 'v1',
        format_version: 1,
        canvas_width: 400,
        canvas_height: 300,
        elements: JSON.stringify([
          {
            ...line('viejo'),
            points: [
              { x: 0.25, y: 0.5 },
              { x: 1, y: 1 },
            ],
          },
        ]),
      }),
    ]);
    // La app lo lee ya en centímetros y guarda lo que lee.
    const opened = await getPlan('a-viejo');
    expect(opened.formatVersion).toBe(1);
    expect(opened.elements[0]?.points).toEqual([
      { x: 100, y: 150 },
      { x: 400, y: 300 },
    ]);

    const result = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', annotationId: 'a-viejo', elements: opened.elements },
      LATER,
    );

    expect(result.ok && result.data.formatVersion).toBe(2);
    const reopened = await getPlan('a-viejo');
    expect(reopened.formatVersion).toBe(2);
    // Releído en el formato 2 conserva los centímetros (no se vuelve a escalar).
    expect(reopened.elements).toEqual(opened.elements);
    expect(parseElements(db.rows('annotations').find((r) => r.id === 'a-viejo')?.elements)).toEqual(
      opened.elements,
    );
  });

  it('no escribe en un plano de otra visita', async () => {
    const before = db.rows('annotations');

    const result = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', annotationId: 'a-v2', elements: [line('l1')] },
      LATER,
    );
    const missing = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', annotationId: 'no-existe', elements: [] },
      LATER,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { message: ANNOTATION_MESSAGES.planNotFound, code: 'not_found' },
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(db.rows('annotations')).toEqual(before);
  });

  it('no escribe en visitas cerradas ni ajenas', async () => {
    db.insert('annotations', [
      annotationRow({ id: 'a-cerrada', visit_id: 'v-cerrada' }),
      annotationRow({ id: 'a-ajena', visit_id: 'v-ajena' }),
    ]);
    const before = db.rows('annotations');

    const closed = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v-cerrada', annotationId: 'a-cerrada', elements: [line('l1')] },
      LATER,
    );
    const foreign = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v-ajena', annotationId: 'a-ajena', elements: [line('l1')] },
      LATER,
    );

    expect(!closed.ok && closed.error.message).toBe(ANNOTATION_MESSAGES.visitClosed);
    expect(!foreign.ok && foreign.error.message).toBe(ANNOTATION_MESSAGES.visitNotFound);
    expect(db.rows('annotations')).toEqual(before);
  });

  it('si el UPDATE falla en SQLite, el plano guardado no cambia (ROLLBACK real)', async () => {
    const before = db.rows('annotations');
    db.raw.exec(`CREATE TRIGGER fallo BEFORE UPDATE ON annotations
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);

    const result = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', annotationId: 'a1', elements: [line('l1')] },
      LATER,
    );

    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('annotations')).toEqual(before);
  });

  it('si el plano desaparece durante el guardado avisa de que no existe', async () => {
    // Simula un borrado concurrente justo después del UPDATE.
    db.raw.exec(`CREATE TRIGGER borrado AFTER UPDATE ON annotations
      BEGIN DELETE FROM annotations WHERE id = NEW.id; END`);

    const result = await saveAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', annotationId: 'a1', elements: [] },
      LATER,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { message: ANNOTATION_MESSAGES.planNotFound },
    });
    // El error deshace la transacción: el plano sigue ahí.
    expect(ids(db.rows('annotations'))).toContain('a1');
  });
});

describe('renameAnnotation y deleteAnnotation', () => {
  beforeEach(() => {
    db.insert('annotations', [
      annotationRow({ id: 'a1', visit_id: 'v1', title: 'Viejo', sync_status: 'synced' }),
      annotationRow({ id: 'a2', visit_id: 'v1' }),
      annotationRow({ id: 'a-v2', visit_id: 'v2' }),
      annotationRow({ id: 'a-cerrada', visit_id: 'v-cerrada' }),
    ]);
  });

  it('renombrar cambia el título limpio y lo deja pendiente de sincronizar', async () => {
    const result = await renameAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', annotationId: 'a1', title: '  Cuarto técnico  ' },
      LATER,
    );

    expect(result.ok).toBe(true);
    expect(await db.get<Row>(ANNOTATION_BY_ID_SQL, ['a1'])).toMatchObject({
      title: 'Cuarto técnico',
      sync_status: 'pendingSync',
      updated_at: LATER.toISOString(),
      elements: '[]',
    });

    await renameAnnotation(db, TECH_A, { visitId: 'v1', annotationId: 'a1', title: ' ' }, LATER);
    expect((await db.get<Row>(ANNOTATION_BY_ID_SQL, ['a1'])).title).toBeNull();
  });

  it('renombrar un plano de otra visita o de una visita cerrada no hace nada', async () => {
    const before = db.rows('annotations');

    const other = await renameAnnotation(
      db,
      TECH_A,
      { visitId: 'v1', annotationId: 'a-v2', title: 'X' },
      LATER,
    );
    const closed = await renameAnnotation(
      db,
      TECH_A,
      { visitId: 'v-cerrada', annotationId: 'a-cerrada', title: 'X' },
      LATER,
    );

    expect(!other.ok && other.error.message).toBe(ANNOTATION_MESSAGES.planNotFound);
    expect(!closed.ok && closed.error.code).toBe('visit_closed');
    expect(db.rows('annotations')).toEqual(before);
  });

  it('eliminar quita solo ese plano', async () => {
    const result = await deleteAnnotation(db, TECH_A, { visitId: 'v1', annotationId: 'a1' });

    expect(result.ok).toBe(true);
    expect(ids(await db.getAll<Row>(ANNOTATIONS_BY_VISIT_SQL, ['v1']))).toEqual(['a2']);
    expect(ids(db.rows('annotations'))).toEqual(['a-cerrada', 'a-v2', 'a2']);
  });

  it('no elimina planos de otra visita, de visitas cerradas ni ajenas', async () => {
    db.insert('annotations', [annotationRow({ id: 'a-ajena', visit_id: 'v-ajena' })]);
    const before = db.rows('annotations');

    const results = [
      await deleteAnnotation(db, TECH_A, { visitId: 'v1', annotationId: 'a-v2' }),
      await deleteAnnotation(db, TECH_A, { visitId: 'v-cerrada', annotationId: 'a-cerrada' }),
      await deleteAnnotation(db, TECH_A, { visitId: 'v-ajena', annotationId: 'a-ajena' }),
    ];

    expect(results.map((result) => !result.ok && result.error.code)).toEqual([
      'not_found',
      'visit_closed',
      'not_found',
    ]);
    expect(db.rows('annotations')).toEqual(before);
  });
});

describe('biblioteca de figuras', () => {
  it('FIGURES_BY_TECHNICIAN_SQL: solo las del técnico, de la más reciente', async () => {
    db.insert('annotation_figures', [
      figureRow({ id: 'f-vieja', created_at: '2026-06-01T00:00:00.000Z' }),
      figureRow({ id: 'f-nueva', created_at: '2026-06-09T00:00:00.000Z' }),
      figureRow({ id: 'f-b', created_at: '2026-06-05T00:00:00.000Z' }),
      figureRow({ id: 'f-a', created_at: '2026-06-05T00:00:00.000Z' }),
      figureRow({ id: 'f-ajena', technician_id: TECH_B }),
    ]);

    expect(ids(await db.getAll<Row>(FIGURES_BY_TECHNICIAN_SQL, [TECH_A]))).toEqual([
      'f-nueva',
      'f-a',
      'f-b',
      'f-vieja',
    ]);
    expect(ids(await db.getAll<Row>(FIGURES_BY_TECHNICIAN_SQL, [TECH_B]))).toEqual(['f-ajena']);
  });

  it('saveFigure guarda la figura con su esquina en (0, 0) y su tamaño', async () => {
    // Marcador de 10 px de radio: con la escala de referencia (1) mide 10 cm.
    const elements = [line('l', { x: 100, y: 50 }, { x: 200, y: 150 }), marker('m', 150, 250)];

    const result = await saveFigure(db, TECH_A, { name: '  Puerta doble ', elements }, NOW);

    expect(result.ok).toBe(true);
    const [row] = db.rows('annotation_figures');
    expect(row).toMatchObject({
      id: 'plano-1',
      technician_id: TECH_A,
      name: 'Puerta doble',
      width: 100,
      height: 210,
      sync_status: 'pendingSync',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    expect(parseElements(row?.elements)).toEqual([
      line('l', { x: 0, y: 0 }, { x: 100, y: 100 }),
      marker('m', 50, 200),
    ]);
    expect(result.ok && result.data).toEqual(figureFromRow(row ?? {}));
  });

  it('saveFigure exige un nombre y al menos un elemento', async () => {
    const noName = await saveFigure(db, TECH_A, { name: '   ', elements: [line('l')] }, NOW);
    const empty = await saveFigure(db, TECH_A, { name: 'Vacía', elements: [] }, NOW);

    expect(noName).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: FIGURE_MESSAGES.noName, code: 'required' },
    });
    expect(empty).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: FIGURE_MESSAGES.empty, code: 'empty' },
    });
    expect(db.rows('annotation_figures')).toEqual([]);
  });

  it('saveFigure devuelve un error si SQLite falla', async () => {
    db.raw.exec(`CREATE TRIGGER fallo BEFORE INSERT ON annotation_figures
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);

    const result = await saveFigure(db, TECH_A, { name: 'X', elements: [line('l')] }, NOW);

    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('annotation_figures')).toEqual([]);
  });

  it('deleteFigure solo elimina figuras del técnico', async () => {
    db.insert('annotation_figures', [
      figureRow({ id: 'f1' }),
      figureRow({ id: 'f2' }),
      figureRow({ id: 'f-ajena', technician_id: TECH_B }),
    ]);

    expect((await deleteFigure(db, TECH_A, 'f1')).ok).toBe(true);
    // Una figura ajena no se toca (no hay error: simplemente no es suya).
    expect((await deleteFigure(db, TECH_A, 'f-ajena')).ok).toBe(true);

    expect(ids(db.rows('annotation_figures'))).toEqual(['f-ajena', 'f2']);
  });

  it('deleteFigure devuelve un error si SQLite falla', async () => {
    db.insert('annotation_figures', [figureRow({ id: 'f1' })]);
    db.raw.exec(`CREATE TRIGGER fallo BEFORE DELETE ON annotation_figures
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);

    const result = await deleteFigure(db, TECH_A, 'f1');

    expect(!result.ok && result.error.kind).toBe('database');
    expect(ids(db.rows('annotation_figures'))).toEqual(['f1']);
  });
});

describe('normalizeFigure y placeFigure', () => {
  it('normalizeFigure mueve la figura a (0, 0) y mide su tamaño', () => {
    const figure = normalizeFigure([
      line('a', { x: -50, y: 30 }, { x: 50, y: 30 }),
      line('b', { x: 0, y: 30 }, { x: 0, y: 130 }),
    ]);

    expect(figure).toEqual({
      elements: [
        line('a', { x: 0, y: 0 }, { x: 100, y: 0 }),
        line('b', { x: 50, y: 0 }, { x: 50, y: 100 }),
      ],
      width: 100,
      height: 100,
    });
    expect(normalizeFigure([])).toEqual({ elements: [], width: 0, height: 0 });
  });

  it('placeFigure la centra en el punto con ids nuevos', () => {
    const figure = {
      elements: [line('a', { x: 0, y: 0 }, { x: 100, y: 200 }), marker('m', 50, 100)],
      width: 100,
      height: 200,
    };
    let counter = 0;
    const placed = placeFigure(figure, { x: 1000, y: -500 }, () => {
      counter += 1;
      return `nuevo-${counter}`;
    });

    expect(placed).toEqual([
      line('nuevo-1', { x: 950, y: -600 }, { x: 1050, y: -400 }),
      marker('nuevo-2', 1000, -500),
    ]);
    // La figura de la biblioteca no cambia.
    expect(figure.elements[0]?.id).toBe('a');
  });

  it('placeFigure usa generateId por defecto', () => {
    const placed = placeFigure(
      { elements: [marker('m', 0, 0)], width: 0, height: 0 },
      {
        x: 5,
        y: 5,
      },
    );

    expect(placed).toEqual([marker('plano-1', 5, 5)]);
  });
});
