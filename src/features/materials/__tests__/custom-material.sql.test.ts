import { summarizeMaterials, visitMaterialFromRow } from '@/models/material.model';
import { catalogRow, TECH_A, TECH_B, visitRow } from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import { VISIT_CUSTOM_MATERIALS_SQL } from '../services/custom-material.queries';
import { VISIT_MATERIALS_SQL } from '../services/material.queries';
import {
  addCustomMaterialToVisit,
  addMaterialToVisit,
  CUSTOM_MATERIAL_CODE,
  MATERIAL_SERVICE_MESSAGES,
  removeVisitMaterial,
  updateVisitMaterial,
} from '../services/material.service';
import { CUSTOM_MATERIAL_MESSAGES, MATERIAL_MESSAGES } from '../validation';

/** Materiales personalizados (solo en la visita) contra SQLite real. */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-10T12:00:00.000Z');
let db: TestDatabase;

beforeEach(() => {
  resetIds('vm');
  db = createTestDatabase();
  db.insert('material_catalog', [
    catalogRow({ id: 'm-abrazadera', code: 'ABR-01', name: 'Abrazadera', unit: 'unidad' }),
  ]);
  db.insert('visits', [
    visitRow({ id: 'v1', status: 'inProgress' }),
    visitRow({ id: 'v2', status: 'inProgress' }),
    visitRow({ id: 'v-cerrada', status: 'completed' }),
    visitRow({ id: 'v-ajena', technician_id: TECH_B, status: 'inProgress' }),
  ]);
});

const custom = (
  name: string,
  unit: string,
  visitId = 'v1',
  quantity = 2,
  observations: string | null = null,
) => addCustomMaterialToVisit(db, TECH_A, { visitId, name, unit, quantity, observations }, NOW);

const addCatalog = (visitId = 'v1') =>
  addMaterialToVisit(
    db,
    TECH_A,
    { visitId, materialId: 'm-abrazadera', quantity: 1, observations: null },
    NOW,
  );

describe('addCustomMaterialToVisit', () => {
  it('guarda material_id NULL, is_custom = 1 y el código PERSONALIZADO con nombre y unidad escritos', async () => {
    const result = await custom('  Abrazadera   especial ', ' bolsa ', 'v1', 3.5, ' tramo B ');

    expect(result.ok && result.data).toMatchObject({
      materialId: null,
      isCustom: true,
      materialCode: CUSTOM_MATERIAL_CODE,
      materialName: 'Abrazadera especial',
      unit: 'bolsa',
      quantity: 3.5,
      observations: 'tramo B',
    });
    expect(await db.getAll(VISIT_MATERIALS_SQL, ['v1'])).toEqual([
      {
        id: 'vm-1',
        visit_id: 'v1',
        material_id: null,
        is_custom: 1,
        material_code: 'PERSONALIZADO',
        material_name: 'Abrazadera especial',
        unit: 'bolsa',
        quantity: 3.5,
        observations: 'tramo B',
        sync_status: 'pendingSync',
        created_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
      },
    ]);
    // El catálogo no cambia.
    expect(db.rows('material_catalog')).toHaveLength(1);
  });

  it('no choca con un material del catálogo del mismo nombre', async () => {
    await addCatalog();
    expect((await custom('Abrazadera', 'unidad')).ok).toBe(true);
    expect(db.rows('visit_materials')).toHaveLength(2);
  });

  it('rechaza dos personalizados con el mismo nombre y unidad en la visita (sin distinguir mayúsculas ni espacios)', async () => {
    await custom('Tubo Ñandú', 'metro');
    const repeated = await custom('  tubo   ñandú ', 'METRO');
    expect(!repeated.ok && repeated.error.message).toBe(MATERIAL_SERVICE_MESSAGES.customDuplicate);
    expect(db.rows('visit_materials')).toHaveLength(1);

    // Otra unidad u otra visita sí se aceptan.
    expect((await custom('Tubo Ñandú', 'caja')).ok).toBe(true);
    expect((await custom('Tubo Ñandú', 'metro', 'v2')).ok).toBe(true);
  });

  it('valida nombre, unidad y cantidad', async () => {
    const noName = await custom('   ', 'metro');
    expect(!noName.ok && noName.error.message).toBe(CUSTOM_MATERIAL_MESSAGES.nameRequired);
    const longName = await custom('x'.repeat(121), 'metro');
    expect(!longName.ok && longName.error.message).toBe(CUSTOM_MATERIAL_MESSAGES.nameTooLong);
    const longUnit = await custom('Tubo', 'x'.repeat(21));
    expect(!longUnit.ok && longUnit.error.message).toBe(CUSTOM_MATERIAL_MESSAGES.unitTooLong);
    const noUnit = await custom('Tubo', ' ');
    expect(!noUnit.ok && noUnit.error.message).toBe(CUSTOM_MATERIAL_MESSAGES.otherUnitRequired);
    const zero = await custom('Tubo', 'metro', 'v1', 0);
    expect(!zero.ok && zero.error.message).toBe(MATERIAL_MESSAGES.quantityPositive);
    expect(db.rows('visit_materials')).toEqual([]);
  });

  it('no escribe en visitas cerradas ni ajenas', async () => {
    const closed = await custom('Tubo', 'metro', 'v-cerrada');
    expect(!closed.ok && closed.error.message).toBe(MATERIAL_SERVICE_MESSAGES.visitClosed);
    const foreign = await custom('Tubo', 'metro', 'v-ajena');
    expect(!foreign.ok && foreign.error.message).toBe(MATERIAL_SERVICE_MESSAGES.visitNotFound);
    expect(db.rows('visit_materials')).toEqual([]);
  });

  it('un fallo de la base vuelve como error y no deja datos', async () => {
    db.raw.exec(`CREATE TRIGGER fallo BEFORE INSERT ON visit_materials
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);
    const result = await custom('Tubo', 'metro');
    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('visit_materials')).toEqual([]);
  });

  it('se edita y se quita como cualquier material de la visita', async () => {
    const added = await custom('Tubo', 'metro');
    if (!added.ok) throw new Error('no se agregó');
    const updated = await updateVisitMaterial(
      db,
      TECH_A,
      { visitId: 'v1', visitMaterialId: added.data.id, quantity: 9, observations: 'x' },
      NOW,
    );
    expect(updated.ok && updated.data).toMatchObject({ quantity: 9, isCustom: true });
    const removed = await removeVisitMaterial(db, TECH_A, {
      visitId: 'v1',
      visitMaterialId: added.data.id,
    });
    expect(removed.ok).toBe(true);
    expect(db.rows('visit_materials')).toEqual([]);
  });

  it('VISIT_CUSTOM_MATERIALS_SQL solo devuelve los personalizados de la visita', async () => {
    await addCatalog();
    await custom('Tubo', 'metro');
    await custom('Tubo', 'metro', 'v2');
    expect(await db.getAll<Row>(VISIT_CUSTOM_MATERIALS_SQL, ['v1'])).toEqual([
      { id: 'vm-2', material_name: 'Tubo', unit: 'metro' },
    ]);
  });

  it('el resumen cuenta los personalizados y suma por unidad con los del catálogo', async () => {
    await addCatalog();
    await custom('Abrazadera grande', 'unidad', 'v1', 2);
    const rows = await db.getAll<Row>(VISIT_MATERIALS_SQL, ['v1']);
    expect(summarizeMaterials(rows.map(visitMaterialFromRow))).toMatchObject({
      count: 2,
      customCount: 1,
      customLabel: '1 personalizado',
      totalsLabel: '3 unidad',
    });
  });
});
