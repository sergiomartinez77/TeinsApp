import { saveAnnotation } from '@/features/annotations/services/annotation.service';
import { completeFormResponse, saveFormResponse } from '@/features/forms/services/response.service';
import {
  addMaterialToVisit,
  removeVisitMaterial,
  updateVisitMaterial,
} from '@/features/materials/services/material.service';
import { createFakeFiles } from '@/features/photos/__tests__/fakes';
import {
  PENDING_UPLOAD_COUNT_SQL,
  PENDING_UPLOADS_SQL,
  RESET_INTERRUPTED_UPLOADS_SQL,
  VISIT_PHOTO_STATS_SQL,
} from '@/features/photos/services/photo.queries';
import { addPhoto, deletePhoto } from '@/features/photos/services/photo.service';
import {
  buildVisitListQuery,
  IN_PROGRESS_VISITS_SQL,
  VISIT_BY_ID_SQL,
  VISIT_FILTERS,
  VISIT_STATS_SQL,
} from '@/features/visits/services/visit.queries';
import { completeVisit, createVisit, startVisit } from '@/features/visits/services/visit.service';
import {
  annotationRow,
  catalogRow,
  photoRow,
  responseRow,
  TECH_A,
  TECH_B,
  visitMaterialRow,
  visitRow,
} from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

/**
 * Aislamiento entre técnicos: con datos de dos técnicos en la misma base,
 * ninguna consulta por técnico devuelve datos del otro y ningún servicio de
 * escritura modifica sus datos.
 */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-10T12:00:00.000Z');
const TABLES = ['visits', 'form_responses', 'visit_materials', 'photos', 'annotations'];

let db: TestDatabase;

/** Mismo contenido para los dos técnicos, con ids distintos. */
function seedTechnician(technicianId: string, prefix: string) {
  db.insert('visits', [
    visitRow({
      id: `${prefix}-asignada`,
      technician_id: technicianId,
      status: 'assigned',
      title: 'Común',
    }),
    visitRow({
      id: `${prefix}-progreso`,
      technician_id: technicianId,
      status: 'inProgress',
      title: 'Común',
      sync_status: 'pendingSync',
    }),
    visitRow({
      id: `${prefix}-completada`,
      technician_id: technicianId,
      status: 'completed',
      title: 'Común',
    }),
  ]);
  db.insert('visit_materials', [
    visitMaterialRow({ id: `${prefix}-vm`, visit_id: `${prefix}-progreso` }),
  ]);
  db.insert('photos', [
    photoRow({
      id: `${prefix}-foto`,
      visit_id: `${prefix}-progreso`,
      local_path: `teins_photos/${prefix}.jpg`,
    }),
    photoRow({
      id: `${prefix}-subiendo`,
      visit_id: `${prefix}-progreso`,
      sync_status: 'uploading',
    }),
  ]);
  db.insert('annotations', [annotationRow({ id: `${prefix}-an`, visit_id: `${prefix}-progreso` })]);
  db.insert('form_responses', [responseRow({ id: `${prefix}-r`, visit_id: `${prefix}-progreso` })]);
}

beforeEach(() => {
  resetIds('nuevo');
  db = createTestDatabase();
  db.insert('material_catalog', [catalogRow()]);
  seedTechnician(TECH_A, 'a');
  seedTechnician(TECH_B, 'b');
});

const rowsOf = (prefix: string) =>
  TABLES.flatMap((table) =>
    db.rows(table).filter((row) => String(row.id).startsWith(`${prefix}-`)),
  );

describe('consultas por técnico', () => {
  it('el listado (todas las pestañas, con y sin búsqueda) solo devuelve visitas propias', async () => {
    for (const { key } of VISIT_FILTERS) {
      for (const search of ['', 'Común']) {
        const query = buildVisitListQuery(TECH_A, { filter: key, search, limit: 100 });
        const rows = await db.getAll<Row>(query.sql, query.parameters);
        expect(rows.every((row) => row.technician_id === TECH_A)).toBe(true);
      }
    }
    const all = buildVisitListQuery(TECH_A, { filter: 'all', search: '', limit: 100 });
    expect(await db.getAll(all.sql, all.parameters)).toHaveLength(3);
  });

  it('estadísticas, en progreso y visita por id', async () => {
    expect(await db.get(VISIT_STATS_SQL, [TECH_A])).toEqual({
      assigned: 1,
      in_progress: 1,
      completed: 1,
      pending_sync: 1,
    });
    expect(
      (await db.getAll<Row>(IN_PROGRESS_VISITS_SQL, [TECH_A, 10])).map((row) => row.id),
    ).toEqual(['a-progreso']);
    expect(await db.getOptional(VISIT_BY_ID_SQL, ['b-progreso', TECH_A])).toBeNull();
  });

  it('fotos: estadísticas, cola de subida y recuperación de subidas interrumpidas', async () => {
    expect(await db.get(VISIT_PHOTO_STATS_SQL, ['b-progreso', TECH_A])).toEqual({
      total: 0,
      pending: 0,
    });
    expect((await db.getAll<Row>(PENDING_UPLOADS_SQL, [TECH_A])).map((row) => row.id)).toEqual([
      'a-foto',
    ]);
    expect(await db.get(PENDING_UPLOAD_COUNT_SQL, [TECH_A])).toEqual({ count: 1 });

    const before = rowsOf('b');
    await db.execute(RESET_INTERRUPTED_UPLOADS_SQL, [TECH_A]);
    expect(rowsOf('b')).toEqual(before);
    expect(db.rows('photos').find((row) => row.id === 'a-subiendo')?.sync_status).toBe(
      'pendingUpload',
    );
  });
});

describe('servicios de escritura', () => {
  it('ningún servicio del técnico A modifica datos del técnico B', async () => {
    const before = rowsOf('b');
    const { files } = createFakeFiles({ 'teins_photos/b.jpg': 10 });
    const visitId = 'b-progreso';
    const template = { id: 'tpl', version: 1, source: 'database' as const };
    const image = { uri: 'file:///cache/x.jpg', width: 10, height: 10 };

    const results = [
      await startVisit(db, TECH_A, 'b-asignada', NOW),
      await completeVisit(db, TECH_A, visitId, NOW),
      await saveFormResponse(db, TECH_A, { visitId, template, values: { f1: 'x' } }, NOW),
      await completeFormResponse(db, TECH_A, { visitId, template, values: {} }, NOW),
      await addMaterialToVisit(
        db,
        TECH_A,
        { visitId, materialId: 'm1', quantity: 1, observations: null },
        NOW,
      ),
      await updateVisitMaterial(
        db,
        TECH_A,
        { visitId, visitMaterialId: 'b-vm', quantity: 5, observations: null },
        NOW,
      ),
      await removeVisitMaterial(db, TECH_A, { visitId, visitMaterialId: 'b-vm' }),
      await addPhoto(db, files, TECH_A, { visitId, image }, NOW),
      await deletePhoto(db, files, TECH_A, { visitId, photoId: 'b-foto' }, NOW),
      await saveAnnotation(
        db,
        TECH_A,
        { visitId, elements: [], canvasWidth: 1, canvasHeight: 1 },
        NOW,
      ),
    ];

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    expect(rowsOf('b')).toEqual(before);
    expect(files.save).not.toHaveBeenCalled();
    expect(files.moveToTrash).not.toHaveBeenCalled();
  });

  it('una visita nueva queda asignada a quien la crea', async () => {
    const created = await createVisit(
      db,
      { id: TECH_B, role: 'technician' },
      { title: 'Nueva', visitType: 'general', address: null, description: null },
      NOW,
    );
    expect(created.ok).toBe(true);
    expect(await db.getOptional(VISIT_BY_ID_SQL, ['nuevo-1', TECH_A])).toBeNull();
    expect(await db.getOptional<Row>(VISIT_BY_ID_SQL, ['nuevo-1', TECH_B])).toMatchObject({
      technician_id: TECH_B,
    });
  });
});
