import { parseElements, type AnnotationElement } from '@/models/annotation.model';

import { ANNOTATION_MESSAGES, saveAnnotation } from '../services/annotation.service';

import { createAnnotationDb, visitRow } from './fake-annotation-db';

jest.mock('@/utils/uuid.utils', () => ({ generateId: () => 'anotacion-1' }));

const NOW = new Date('2026-06-01T10:00:00.000Z');
const LATER = new Date('2026-06-01T10:05:00.000Z');

const element = (id: string): AnnotationElement => ({
  id,
  type: 'line',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.9 },
  ],
  color: 0xffc62828,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
});

const input = (elements: AnnotationElement[], width = 390, height = 600) => ({
  visitId: 'v1',
  elements,
  canvasWidth: width,
  canvasHeight: height,
});

describe('saveAnnotation', () => {
  it('el primer guardado inserta la fila con la referencia del canvas', async () => {
    const { db, rows } = createAnnotationDb();

    const result = await saveAnnotation(db, 't1', input([element('a')]), NOW);

    expect(result.ok).toBe(true);
    expect(rows.size).toBe(1);
    const row = rows.get('anotacion-1');
    expect(row).toMatchObject({
      visit_id: 'v1',
      title: null,
      base_image_path: null,
      canvas_width: 390,
      canvas_height: 600,
      sync_status: 'pendingSync',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    expect(parseElements(row?.elements)).toEqual([element('a')]);
    if (result.ok) expect(result.data.elements).toHaveLength(1);
  });

  it('el segundo guardado actualiza la misma fila y conserva la referencia', async () => {
    const { db, rows, statements } = createAnnotationDb();

    await saveAnnotation(db, 't1', input([element('a')]), NOW);
    const result = await saveAnnotation(
      db,
      't1',
      input([element('a'), element('b')], 800, 500),
      LATER,
    );

    expect(result.ok).toBe(true);
    expect(rows.size).toBe(1);
    expect(statements.filter((sql) => sql.includes('INSERT'))).toHaveLength(1);
    const row = rows.get('anotacion-1');
    expect(row).toMatchObject({
      canvas_width: 390,
      canvas_height: 600,
      created_at: NOW.toISOString(),
      updated_at: LATER.toISOString(),
      sync_status: 'pendingSync',
    });
    expect(parseElements(row?.elements)).toHaveLength(2);
  });

  it('una fila sincronizada sin referencia la recibe al guardar', async () => {
    const { db, rows } = createAnnotationDb({
      annotations: [
        {
          id: 'remota',
          visit_id: 'v1',
          elements: '[]',
          canvas_width: null,
          canvas_height: null,
          sync_status: 'synced',
          created_at: '2026-05-30T08:00:00.000Z',
        },
      ],
    });

    await saveAnnotation(db, 't1', input([element('a')], 360, 480), NOW);

    expect(rows.size).toBe(1);
    expect(rows.get('remota')).toMatchObject({
      canvas_width: 360,
      canvas_height: 480,
      sync_status: 'pendingSync',
    });
  });

  it.each(['completed', 'pendingReview', 'synced'])(
    'una visita en estado %s rechaza el guardado sin escribir',
    async (status) => {
      const { db, rows, statements } = createAnnotationDb({ visits: [visitRow({ status })] });

      const result = await saveAnnotation(db, 't1', input([element('a')]), NOW);

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          kind: 'validation',
          message: ANNOTATION_MESSAGES.visitClosed,
        }),
      });
      expect(rows.size).toBe(0);
      expect(statements).toEqual([]);
    },
  );

  it('una visita ajena o inexistente rechaza el guardado sin escribir', async () => {
    const { db, rows } = createAnnotationDb({ visits: [visitRow({ technician_id: 'otro' })] });

    const ajena = await saveAnnotation(db, 't1', input([element('a')]), NOW);
    const inexistente = await saveAnnotation(
      db,
      't1',
      { ...input([element('a')]), visitId: 'no-existe' },
      NOW,
    );

    for (const result of [ajena, inexistente]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toBe(ANNOTATION_MESSAGES.visitNotFound);
    }
    expect(rows.size).toBe(0);
  });

  it('si la escritura falla devuelve un error y no deja nada a medias', async () => {
    const { db, rows, failNextWrite } = createAnnotationDb();
    failNextWrite(new Error('disco lleno'));

    const result = await saveAnnotation(db, 't1', input([element('a')]), NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('database');
    expect(rows.size).toBe(0);
  });
});
