import { catalogRow, ids, TECH_A, TECH_B, visitMaterialRow, visitRow } from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import {
  buildCatalogQuery,
  CATALOG_MATERIAL_BY_ID_SQL,
  OWN_VISIT_SQL,
  VISIT_MATERIAL_BY_ID_SQL,
  VISIT_MATERIAL_BY_MATERIAL_SQL,
  VISIT_MATERIALS_SQL,
} from '../services/material.queries';
import {
  addMaterialToVisit,
  MATERIAL_SERVICE_MESSAGES,
  removeVisitMaterial,
  updateVisitMaterial,
} from '../services/material.service';

/** Consultas y escrituras de materiales ejecutadas contra SQLite real. */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-10T12:00:00.000Z');

const CATALOG: Row[] = [
  catalogRow({ id: 'm-cable', code: 'CAB-01', name: 'cable UTP', unit: 'metro' }),
  catalogRow({ id: 'm-canaleta', code: 'CAN-01', name: 'Canaleta 40%', unit: 'metro' }),
  catalogRow({ id: 'm-caneria', code: 'TUB-01', name: 'Cañería PVC', unit: 'metro' }),
  catalogRow({ id: 'm-breaker', code: 'BRK_20', name: 'Breaker 20A', unit: 'unidad' }),
  catalogRow({ id: 'm-a-dup', code: 'ZZZ-02', name: 'Abrazadera', unit: 'unidad' }),
  catalogRow({ id: 'm-a-dup-0', code: 'ZZZ-01', name: 'abrazadera', unit: 'unidad' }),
  catalogRow({ id: 'm-inactivo', code: 'OLD-01', name: 'Cable antiguo', is_active: 0 }),
];

let db: TestDatabase;

beforeEach(() => {
  resetIds('vm');
  db = createTestDatabase();
  db.insert('material_catalog', CATALOG);
  db.insert('visits', [
    visitRow({ id: 'v-abierta', status: 'inProgress' }),
    visitRow({ id: 'v-asignada', status: 'assigned' }),
    visitRow({ id: 'v-cerrada', status: 'completed' }),
    visitRow({ id: 'v-ajena', technician_id: TECH_B, status: 'inProgress' }),
  ]);
});

const catalog = async (search: string, limit = 50) => {
  const query = buildCatalogQuery({ search, limit });
  return ids(await db.getAll<Row>(query.sql, query.parameters));
};

describe('buildCatalogQuery', () => {
  it('lista solo materiales activos, por nombre sin distinguir mayúsculas y luego por código', async () => {
    expect(await catalog('')).toEqual([
      'm-a-dup-0',
      'm-a-dup',
      'm-breaker',
      'm-cable',
      'm-canaleta',
      'm-caneria',
    ]);
  });

  it('busca en código y nombre, también con acentos y mayúsculas', async () => {
    expect(await catalog('cab-01')).toEqual(['m-cable']);
    expect(await catalog('UTP')).toEqual(['m-cable']);
    expect(await catalog('CAÑERÍA')).toEqual(['m-caneria']);
    expect(await catalog('cañería')).toEqual(['m-caneria']);
  });

  it('no encuentra materiales inactivos', async () => {
    expect(await catalog('antiguo')).toEqual([]);
  });

  it('trata % y _ como texto literal', async () => {
    expect(await catalog('40%')).toEqual(['m-canaleta']);
    expect(await catalog('_')).toEqual(['m-breaker']);
    expect(await catalog('%')).toEqual(['m-canaleta']);
  });

  it('respeta el límite para paginar', async () => {
    expect(await catalog('', 2)).toEqual(['m-a-dup-0', 'm-a-dup']);
  });
});

describe('consultas por id', () => {
  beforeEach(() => {
    db.insert('visit_materials', [
      visitMaterialRow({
        id: 'vm-2',
        visit_id: 'v-abierta',
        material_id: 'm-cable',
        created_at: '2026-06-02T00:00:00.000Z',
      }),
      visitMaterialRow({
        id: 'vm-1',
        visit_id: 'v-abierta',
        material_id: 'm-breaker',
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      visitMaterialRow({ id: 'vm-otra', visit_id: 'v-asignada', material_id: 'm-cable' }),
    ]);
  });

  it('VISIT_MATERIALS_SQL: materiales de la visita en orden de alta', async () => {
    expect(ids(await db.getAll<Row>(VISIT_MATERIALS_SQL, ['v-abierta']))).toEqual(['vm-1', 'vm-2']);
  });

  it('VISIT_MATERIAL_BY_MATERIAL_SQL y VISIT_MATERIAL_BY_ID_SQL filtran por visita', async () => {
    expect(await db.getOptional(VISIT_MATERIAL_BY_MATERIAL_SQL, ['v-abierta', 'm-cable'])).toEqual({
      id: 'vm-2',
    });
    expect(
      await db.getOptional(VISIT_MATERIAL_BY_MATERIAL_SQL, ['v-abierta', 'm-caneria']),
    ).toBeNull();
    expect(await db.getOptional(VISIT_MATERIAL_BY_ID_SQL, ['vm-otra', 'v-abierta'])).toBeNull();
    expect(
      await db.getOptional<Row>(VISIT_MATERIAL_BY_ID_SQL, ['vm-otra', 'v-asignada']),
    ).toMatchObject({
      id: 'vm-otra',
    });
  });

  it('OWN_VISIT_SQL y CATALOG_MATERIAL_BY_ID_SQL', async () => {
    expect(await db.getOptional(OWN_VISIT_SQL, ['v-abierta', TECH_A])).toEqual({
      id: 'v-abierta',
      status: 'inProgress',
    });
    expect(await db.getOptional(OWN_VISIT_SQL, ['v-ajena', TECH_A])).toBeNull();
    expect(await db.getOptional<Row>(CATALOG_MATERIAL_BY_ID_SQL, ['m-inactivo'])).toMatchObject({
      is_active: 0,
    });
  });
});

describe('material.service contra SQLite real', () => {
  const add = (
    visitId: string,
    materialId: string,
    quantity = 2,
    observations: string | null = null,
  ) => addMaterialToVisit(db, TECH_A, { visitId, materialId, quantity, observations }, NOW);

  it('agrega un material copiando código, nombre y unidad del catálogo', async () => {
    const result = await add('v-abierta', 'm-cable', 12.5, '  tramo norte  ');

    expect(result.ok).toBe(true);
    expect(await db.getAll(VISIT_MATERIALS_SQL, ['v-abierta'])).toEqual([
      {
        id: 'vm-1',
        visit_id: 'v-abierta',
        material_id: 'm-cable',
        material_code: 'CAB-01',
        material_name: 'cable UTP',
        unit: 'metro',
        quantity: 12.5,
        observations: 'tramo norte',
        sync_status: 'pendingSync',
        created_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
        // Material del catálogo (no personalizado).
        is_custom: 0,
      },
    ]);
  });

  it('también en una visita asignada (aún no iniciada)', async () => {
    expect((await add('v-asignada', 'm-cable')).ok).toBe(true);
  });

  it('rechaza duplicados, materiales inactivos o inexistentes y cantidades inválidas', async () => {
    await add('v-abierta', 'm-cable');

    const duplicate = await add('v-abierta', 'm-cable');
    expect(!duplicate.ok && duplicate.error.message).toBe(MATERIAL_SERVICE_MESSAGES.duplicate);
    const inactive = await add('v-abierta', 'm-inactivo');
    expect(!inactive.ok && inactive.error.message).toBe(
      MATERIAL_SERVICE_MESSAGES.materialUnavailable,
    );
    const missing = await add('v-abierta', 'no-existe');
    expect(!missing.ok && missing.error.code).toBe('material_unavailable');
    const zero = await add('v-abierta', 'm-breaker', 0);
    expect(!zero.ok && zero.error.code).toBe('invalid_quantity');

    expect(db.rows('visit_materials')).toHaveLength(1);
  });

  it('no escribe en visitas cerradas ni ajenas', async () => {
    const closed = await add('v-cerrada', 'm-cable');
    expect(!closed.ok && closed.error.message).toBe(MATERIAL_SERVICE_MESSAGES.visitClosed);
    const foreign = await add('v-ajena', 'm-cable');
    expect(!foreign.ok && foreign.error.message).toBe(MATERIAL_SERVICE_MESSAGES.visitNotFound);
    expect(db.rows('visit_materials')).toEqual([]);
  });

  it('edita cantidad y observaciones, y quita el material', async () => {
    await add('v-abierta', 'm-cable');
    const later = new Date('2026-06-10T13:00:00.000Z');

    const updated = await updateVisitMaterial(
      db,
      TECH_A,
      { visitId: 'v-abierta', visitMaterialId: 'vm-1', quantity: 3.25, observations: '' },
      later,
    );
    expect(updated.ok && updated.data.quantity).toBe(3.25);
    expect(await db.get<Row>(VISIT_MATERIAL_BY_ID_SQL, ['vm-1', 'v-abierta'])).toMatchObject({
      quantity: 3.25,
      observations: null,
      updated_at: later.toISOString(),
      created_at: NOW.toISOString(),
    });

    const removed = await removeVisitMaterial(db, TECH_A, {
      visitId: 'v-abierta',
      visitMaterialId: 'vm-1',
    });
    expect(removed.ok).toBe(true);
    expect(db.rows('visit_materials')).toEqual([]);
  });

  it('editar o quitar un material de otra visita falla sin tocar nada', async () => {
    db.insert('visit_materials', [visitMaterialRow({ id: 'vm-x', visit_id: 'v-asignada' })]);
    const before = db.rows('visit_materials');

    const updated = await updateVisitMaterial(db, TECH_A, {
      visitId: 'v-abierta',
      visitMaterialId: 'vm-x',
      quantity: 9,
      observations: null,
    });
    expect(!updated.ok && updated.error.message).toBe(MATERIAL_SERVICE_MESSAGES.itemNotFound);
    const removed = await removeVisitMaterial(db, TECH_A, {
      visitId: 'v-abierta',
      visitMaterialId: 'vm-x',
    });
    expect(!removed.ok && removed.error.code).toBe('item_not_found');

    expect(db.rows('visit_materials')).toEqual(before);
  });

  it('si el INSERT falla en SQLite no queda nada (ROLLBACK real)', async () => {
    db.raw.exec(`CREATE TRIGGER fallo BEFORE INSERT ON visit_materials
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);
    const result = await add('v-abierta', 'm-cable');
    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('visit_materials')).toEqual([]);
  });
});
