import {
  addMaterialToVisit,
  MATERIAL_SERVICE_MESSAGES,
  removeVisitMaterial,
  updateVisitMaterial,
} from '../services/material.service';
import { MATERIAL_MESSAGES } from '../validation';

import { catalogRow, createDb, visitMaterialRow, visitRow } from './fake-material-db';

let mockIdCounter = 0;
jest.mock('@/utils/uuid.utils', () => ({
  generateId: () => {
    mockIdCounter += 1;
    return `material-${mockIdCounter}`;
  },
}));

const T1 = new Date('2026-06-01T10:00:00.000Z');
const T2 = new Date('2026-06-01T10:05:00.000Z');

const ADD = { visitId: 'v1', materialId: 'm1', quantity: 12.5, observations: 'Tramo sala 2' };
const UPDATE = { visitId: 'v1', visitMaterialId: 'vm1', quantity: 3, observations: null };
const REMOVE = { visitId: 'v1', visitMaterialId: 'vm1' };

beforeEach(() => {
  mockIdCounter = 0;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('addMaterialToVisit', () => {
  it('copia código, nombre y unidad del catálogo y queda pendiente de sincronizar', async () => {
    const { db, materials } = createDb();

    const result = await addMaterialToVisit(db, 't1', ADD, T1);

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: 'material-1',
        visitId: 'v1',
        materialId: 'm1',
        materialCode: 'CAB-001',
        materialName: 'Cable UTP Cat6',
        unit: 'metro',
        quantity: 12.5,
        observations: 'Tramo sala 2',
        syncStatus: 'pendingSync',
      },
    });
    expect(materials.get('material-1')).toEqual({
      id: 'material-1',
      visit_id: 'v1',
      material_id: 'm1',
      material_code: 'CAB-001',
      material_name: 'Cable UTP Cat6',
      unit: 'metro',
      quantity: 12.5,
      observations: 'Tramo sala 2',
      sync_status: 'pendingSync',
      created_at: '2026-06-01T10:00:00.000Z',
      updated_at: '2026-06-01T10:00:00.000Z',
    });
  });

  it('nunca escribe en el catálogo', async () => {
    const { db, statements, catalog } = createDb();

    await addMaterialToVisit(db, 't1', ADD, T1);

    expect(statements.some((sql) => sql.includes('material_catalog'))).toBe(false);
    expect(catalog.get('m1')).toEqual(catalogRow());
  });

  it('normaliza observaciones vacías a null', async () => {
    const { db, materials } = createDb();

    await addMaterialToVisit(db, 't1', { ...ADD, observations: '   ' }, T1);

    expect(materials.get('material-1')?.observations).toBeNull();
  });

  it('rechaza un material que ya está en la visita sin escribir nada', async () => {
    const { db, materials, statements } = createDb({ materials: [visitMaterialRow()] });

    const result = await addMaterialToVisit(db, 't1', ADD, T1);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'validation',
        message: MATERIAL_SERVICE_MESSAGES.duplicate,
      }),
    });
    expect(materials.size).toBe(1);
    expect(statements).toHaveLength(0);
  });

  it('permite el mismo material en otra visita', async () => {
    const { db, materials } = createDb({
      visits: [visitRow(), visitRow({ id: 'v2' })],
      materials: [visitMaterialRow({ visit_id: 'v2' })],
    });

    const result = await addMaterialToVisit(db, 't1', ADD, T1);

    expect(result.ok).toBe(true);
    expect(materials.size).toBe(2);
  });

  it.each([
    ['inexistente', []],
    ['inactivo', [catalogRow({ is_active: 0 })]],
  ])('rechaza un material %s del catálogo', async (_label, catalog) => {
    const { db, materials } = createDb({ catalog });

    const result = await addMaterialToVisit(db, 't1', ADD, T1);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: MATERIAL_SERVICE_MESSAGES.materialUnavailable },
    });
    expect(materials.size).toBe(0);
  });

  it('rechaza una cantidad no válida sin abrir la transacción', async () => {
    const { db, materials } = createDb();

    const result = await addMaterialToVisit(db, 't1', { ...ADD, quantity: 0 }, T1);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: MATERIAL_MESSAGES.quantityPositive },
    });
    expect(materials.size).toBe(0);
  });

  it('si falla la escritura devuelve un error y no deja datos a medias', async () => {
    const { db, materials, failNextWrite } = createDb();
    failNextWrite(new Error('disco lleno'));

    const result = await addMaterialToVisit(db, 't1', ADD, T1);

    expect(result).toMatchObject({ ok: false, error: { kind: 'database' } });
    expect(materials.size).toBe(0);
  });
});

describe('updateVisitMaterial', () => {
  it('cambia cantidad, observaciones, updated_at y sync_status', async () => {
    const { db, materials } = createDb({
      materials: [visitMaterialRow({ observations: 'Antes' })],
    });

    const result = await updateVisitMaterial(db, 't1', { ...UPDATE, quantity: 7.25 }, T2);

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: 'vm1',
        quantity: 7.25,
        observations: null,
        syncStatus: 'pendingSync',
        updatedAt: '2026-06-01T10:05:00.000Z',
        createdAt: '2026-06-01T08:00:00.000Z',
      },
    });
    expect(materials.get('vm1')).toMatchObject({
      quantity: 7.25,
      observations: null,
      sync_status: 'pendingSync',
      updated_at: '2026-06-01T10:05:00.000Z',
      created_at: '2026-06-01T08:00:00.000Z',
      material_name: 'Cable UTP Cat6',
    });
  });

  it('rechaza un material que no está en la visita', async () => {
    const { db } = createDb({ materials: [visitMaterialRow({ visit_id: 'otra' })] });

    const result = await updateVisitMaterial(db, 't1', UPDATE, T2);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: MATERIAL_SERVICE_MESSAGES.itemNotFound },
    });
  });

  it('si falla la escritura devuelve un error y no cambia la fila', async () => {
    const { db, materials, failNextWrite } = createDb({ materials: [visitMaterialRow()] });
    failNextWrite(new Error('disco lleno'));

    const result = await updateVisitMaterial(db, 't1', UPDATE, T2);

    expect(result).toMatchObject({ ok: false, error: { kind: 'database' } });
    expect(materials.get('vm1')).toEqual(visitMaterialRow());
  });
});

describe('removeVisitMaterial', () => {
  it('borra la fila', async () => {
    const { db, materials, statements } = createDb({
      materials: [visitMaterialRow(), visitMaterialRow({ id: 'vm2', material_id: 'm2' })],
    });

    const result = await removeVisitMaterial(db, 't1', REMOVE);

    expect(result.ok).toBe(true);
    expect(materials.has('vm1')).toBe(false);
    expect(materials.has('vm2')).toBe(true);
    expect(statements).toEqual(['DELETE FROM visit_materials WHERE id = ?']);
  });

  it('si falla la escritura devuelve un error y conserva la fila', async () => {
    const { db, materials, failNextWrite } = createDb({ materials: [visitMaterialRow()] });
    failNextWrite(new Error('disco lleno'));

    const result = await removeVisitMaterial(db, 't1', REMOVE);

    expect(result).toMatchObject({ ok: false, error: { kind: 'database' } });
    expect(materials.has('vm1')).toBe(true);
  });
});

describe('visita no modificable', () => {
  const operations = [
    [
      'agregar',
      (db: Parameters<typeof addMaterialToVisit>[0]) => addMaterialToVisit(db, 't1', ADD, T1),
    ],
    [
      'editar',
      (db: Parameters<typeof addMaterialToVisit>[0]) => updateVisitMaterial(db, 't1', UPDATE, T2),
    ],
    [
      'eliminar',
      (db: Parameters<typeof addMaterialToVisit>[0]) => removeVisitMaterial(db, 't1', REMOVE),
    ],
  ] as const;

  describe.each(operations)('%s', (_label, operation) => {
    it.each(['completed', 'pendingReview', 'synced'])(
      'se rechaza con la visita en estado %s sin escribir nada',
      async (status) => {
        const { db, materials, statements } = createDb({
          visits: [visitRow({ status })],
          materials: [visitMaterialRow({ material_id: 'otro' })],
        });

        const result = await operation(db);

        expect(result).toMatchObject({
          ok: false,
          error: { kind: 'validation', message: MATERIAL_SERVICE_MESSAGES.visitClosed },
        });
        expect(statements).toHaveLength(0);
        expect(materials.get('vm1')).toEqual(visitMaterialRow({ material_id: 'otro' }));
      },
    );

    it.each([
      ['ajena', [visitRow({ technician_id: 'otro-tecnico' })]],
      ['inexistente', []],
    ])('se rechaza con una visita %s', async (_kind, visits) => {
      const { db, statements } = createDb({
        visits,
        materials: [visitMaterialRow({ material_id: 'otro' })],
      });

      const result = await operation(db);

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'validation', message: MATERIAL_SERVICE_MESSAGES.visitNotFound },
      });
      expect(statements).toHaveLength(0);
    });
  });

  it('se permite modificar una visita asignada', async () => {
    const { db } = createDb({ visits: [visitRow({ status: 'assigned' })] });

    const result = await addMaterialToVisit(db, 't1', ADD, T1);

    expect(result.ok).toBe(true);
  });
});
