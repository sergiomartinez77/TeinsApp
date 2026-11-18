import { renderHook } from '@testing-library/react-native';

import { ANNOTATION_BY_VISIT_SQL } from '@/features/annotations/services/annotation.queries';
import {
  ANNOTATION_MESSAGES,
  saveAnnotation,
} from '@/features/annotations/services/annotation.service';
import {
  completeFormResponse,
  RESPONSE_BY_VISIT_SQL,
  RESPONSE_MESSAGES,
  saveFormResponse,
} from '@/features/forms/services/response.service';
import { VISIT_MATERIALS_SQL } from '@/features/materials/services/material.queries';
import {
  addMaterialToVisit,
  MATERIAL_SERVICE_MESSAGES,
  removeVisitMaterial,
  updateVisitMaterial,
} from '@/features/materials/services/material.service';
import { createFakeFiles } from '@/features/photos/__tests__/fakes';
import { VISIT_PHOTO_STATS_SQL } from '@/features/photos/services/photo.queries';
import {
  addPhoto,
  deletePhoto,
  PHOTO_SERVICE_MESSAGES,
} from '@/features/photos/services/photo.service';
import { useVisitSummary } from '@/features/visits/hooks/useVisitSummary';
import { VISIT_BY_ID_SQL, VISIT_STATS_SQL } from '@/features/visits/services/visit.queries';
import { completeVisit, createVisit, startVisit } from '@/features/visits/services/visit.service';
import type { AnnotationElement } from '@/models/annotation.model';
import { visitFromRow } from '@/models/visit.model';
import { catalogRow, TECH_A, templateRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

/**
 * Flujo completo de una visita a nivel de servicios, sobre SQLite real y sin
 * simular servicios ni hooks: crear → iniciar → formulario → materiales →
 * foto → anotación → completar formulario → finalizar → solo lectura → resumen.
 */

jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const at = (minute: number) => new Date(Date.UTC(2026, 5, 10, 9, minute));
const TEMPLATE = { id: 'tpl-db-1', version: 3, source: 'database' as const };

const stroke: AnnotationElement = {
  id: 'trazo-1',
  type: 'freeStroke',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.3 },
    { x: 0.4, y: 0.2 },
  ],
  color: 0xff1565c0,
  strokeWidth: 3,
  text: null,
  fontSize: null,
  opacity: 1,
};

let db: TestDatabase;

beforeEach(() => {
  resetIds('id');
  db = createTestDatabase();
  db.insert('form_templates', [templateRow()]);
  db.insert('material_catalog', [
    catalogRow({ id: 'm-cable', code: 'CAB', name: 'Cable UTP', unit: 'metro' }),
    catalogRow({ id: 'm-conector', code: 'RJ45', name: 'Conector RJ45', unit: 'unidad' }),
  ]);
  setTestDatabase(db);
});

afterEach(() => setTestDatabase(null));

it('recorre una visita de principio a fin y después queda cerrada a toda escritura', async () => {
  const user = { id: TECH_A, role: 'technician' as const };
  const { files, stored } = createFakeFiles();

  // 1. Crear e iniciar.
  const created = await createVisit(
    db,
    user,
    { title: 'Instalación de red', visitType: 'general', address: 'Piso 3', description: null },
    at(0),
  );
  if (!created.ok) throw new Error('no se creó la visita');
  const visitId = created.data.id;
  expect((await startVisit(db, TECH_A, visitId, at(1))).ok).toBe(true);

  // 2. Primer guardado del formulario: la visita registra la plantilla y su versión.
  const form = { visitId, template: TEMPLATE, values: { f1: 'Borrador' } };
  expect((await saveFormResponse(db, TECH_A, form, at(2))).ok).toBe(true);
  expect(await db.get<Row>(VISIT_BY_ID_SQL, [visitId, TECH_A])).toMatchObject({
    form_template_id: 'tpl-db-1',
    form_template_version: 3,
  });

  // 3. Materiales: agregar dos, editar uno y quitar el otro.
  const cable = await addMaterialToVisit(
    db,
    TECH_A,
    { visitId, materialId: 'm-cable', quantity: 10, observations: null },
    at(3),
  );
  const connector = await addMaterialToVisit(
    db,
    TECH_A,
    { visitId, materialId: 'm-conector', quantity: 4, observations: null },
    at(4),
  );
  if (!cable.ok || !connector.ok) throw new Error('no se agregaron los materiales');
  const edited = await updateVisitMaterial(
    db,
    TECH_A,
    { visitId, visitMaterialId: cable.data.id, quantity: 12.5, observations: 'Tramo A' },
    at(5),
  );
  expect(edited.ok).toBe(true);
  const removed = await removeVisitMaterial(db, TECH_A, {
    visitId,
    visitMaterialId: connector.data.id,
  });
  expect(removed.ok).toBe(true);

  // 4. Foto y anotación.
  const photo = await addPhoto(
    db,
    files,
    TECH_A,
    { visitId, image: { uri: 'file:///cache/tmp.jpg', width: 1920, height: 1080 } },
    at(6),
  );
  if (!photo.ok) throw new Error('no se guardó la foto');
  const annotated = await saveAnnotation(
    db,
    TECH_A,
    { visitId, elements: [stroke], canvasWidth: 390, canvasHeight: 600 },
    at(7),
  );
  expect(annotated.ok).toBe(true);

  // 5. Completar el formulario y finalizar la visita.
  const formDone = await completeFormResponse(
    db,
    TECH_A,
    { ...form, values: { f1: 'Listo' } },
    at(8),
  );
  expect(formDone.ok).toBe(true);
  const finished = await completeVisit(db, TECH_A, visitId, at(9));
  expect(finished.ok && finished.data.status).toBe('completed');

  // 6. Tras finalizar, ningún servicio escribe.
  const snapshot = () =>
    ['visits', 'form_responses', 'visit_materials', 'photos', 'annotations'].map((table) =>
      db.rows(table),
    );
  const before = snapshot();
  const later = at(30);

  const formWrite = await saveFormResponse(db, TECH_A, { ...form, values: { f1: 'X' } }, later);
  expect(!formWrite.ok && formWrite.error.message).toBe(RESPONSE_MESSAGES.visitClosed);
  const formComplete = await completeFormResponse(db, TECH_A, form, later);
  expect(!formComplete.ok && formComplete.error.code).toBe('visit_closed');

  const materialAdd = await addMaterialToVisit(
    db,
    TECH_A,
    { visitId, materialId: 'm-conector', quantity: 1, observations: null },
    later,
  );
  expect(!materialAdd.ok && materialAdd.error.message).toBe(MATERIAL_SERVICE_MESSAGES.visitClosed);
  const materialEdit = await updateVisitMaterial(
    db,
    TECH_A,
    { visitId, visitMaterialId: cable.data.id, quantity: 1, observations: null },
    later,
  );
  expect(!materialEdit.ok && materialEdit.error.code).toBe('visit_closed');
  const materialRemove = await removeVisitMaterial(db, TECH_A, {
    visitId,
    visitMaterialId: cable.data.id,
  });
  expect(!materialRemove.ok && materialRemove.error.code).toBe('visit_closed');

  const photoAdd = await addPhoto(
    db,
    files,
    TECH_A,
    { visitId, image: { uri: 'file:///cache/otra.jpg', width: 10, height: 10 } },
    later,
  );
  expect(!photoAdd.ok && photoAdd.error.message).toBe(PHOTO_SERVICE_MESSAGES.visitClosed);
  const photoDelete = await deletePhoto(
    db,
    files,
    TECH_A,
    { visitId, photoId: photo.data.id },
    later,
  );
  expect(!photoDelete.ok && photoDelete.error.code).toBe('visit_closed');

  const annotationWrite = await saveAnnotation(
    db,
    TECH_A,
    { visitId, elements: [], canvasWidth: 1, canvasHeight: 1 },
    later,
  );
  expect(!annotationWrite.ok && annotationWrite.error.message).toBe(
    ANNOTATION_MESSAGES.visitClosed,
  );

  const restart = await startVisit(db, TECH_A, visitId, later);
  expect(!restart.ok && restart.error.code).toBe('invalid_transition');

  expect(snapshot()).toEqual(before);
  expect(stored.size).toBe(1);

  // 7. Datos del resumen.
  const storedVisit = await db.get<Row>(VISIT_BY_ID_SQL, [visitId, TECH_A]);
  expect(storedVisit).toMatchObject({
    status: 'completed',
    started_at: at(1).toISOString(),
    completed_at: at(9).toISOString(),
    sync_status: 'pendingSync',
  });
  expect(await db.get(VISIT_STATS_SQL, [TECH_A])).toEqual({
    assigned: 0,
    in_progress: 0,
    completed: 1,
    pending_sync: 1,
  });
  expect(await db.getAll(VISIT_MATERIALS_SQL, [visitId])).toMatchObject([
    { material_id: 'm-cable', quantity: 12.5, observations: 'Tramo A', unit: 'metro' },
  ]);
  expect(await db.get(VISIT_PHOTO_STATS_SQL, [visitId, TECH_A])).toEqual({ total: 1, pending: 1 });
  expect(await db.get<Row>(RESPONSE_BY_VISIT_SQL, [visitId])).toMatchObject({
    is_complete: 1,
    completed_at: at(8).toISOString(),
  });
  expect((await db.get<Row>(ANNOTATION_BY_VISIT_SQL, [visitId])).canvas_width).toBe(390);

  const { result } = await renderHook(() => useVisitSummary(TECH_A, visitFromRow(storedVisit)));
  expect(result.current).toEqual({
    // Varios formularios por visita: ahora se cuentan (antes "Completado · <plantilla>").
    'form-select': '1 formulario · 1 completado',
    materials: '1 material · 12,5 metro',
    photos: '1 fotografía · 1 por subir',
    annotations: '1 elemento',
  });
});
