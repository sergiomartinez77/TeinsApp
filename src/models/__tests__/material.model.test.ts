import {
  catalogMaterialFromRow,
  formatQuantityWithUnit,
  summarizeMaterials,
  visitMaterialFromRow,
  type VisitMaterial,
} from '../material.model';

const material = (overrides: Partial<VisitMaterial> = {}): VisitMaterial => ({
  id: 'vm1',
  visitId: 'v1',
  materialId: 'm1',
  isCustom: false,
  materialCode: 'CAB-001',
  materialName: 'Cable UTP Cat6',
  unit: 'metro',
  quantity: 1,
  observations: null,
  syncStatus: 'pendingSync',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  ...overrides,
});

describe('catalogMaterialFromRow', () => {
  it('convierte la fila del catálogo', () => {
    expect(
      catalogMaterialFromRow({
        id: 'm1',
        code: 'CAB-001',
        name: 'Cable UTP Cat6',
        description: '  ',
        unit: 'metro',
        category: 'Cableado',
        is_active: 1,
      }),
    ).toEqual({
      id: 'm1',
      code: 'CAB-001',
      name: 'Cable UTP Cat6',
      description: null,
      unit: 'metro',
      category: 'Cableado',
      isActive: true,
    });
  });

  it('trata como inactivo un material con is_active distinto de 1', () => {
    expect(catalogMaterialFromRow({ id: 'm1', is_active: 0 }).isActive).toBe(false);
    expect(catalogMaterialFromRow({ id: 'm1', is_active: null }).isActive).toBe(false);
  });
});

describe('visitMaterialFromRow', () => {
  it('convierte la fila del material de la visita', () => {
    expect(
      visitMaterialFromRow({
        id: 'vm1',
        visit_id: 'v1',
        material_id: 'm1',
        material_code: 'CAB-001',
        material_name: 'Cable UTP Cat6',
        unit: 'metro',
        quantity: 12.5,
        observations: 'Tramo sala 2',
        sync_status: 'synced',
        created_at: '2026-06-01T10:00:00.000Z',
        updated_at: '2026-06-01T11:00:00.000Z',
      }),
    ).toEqual(
      material({
        quantity: 12.5,
        observations: 'Tramo sala 2',
        syncStatus: 'synced',
        updatedAt: '2026-06-01T11:00:00.000Z',
      }),
    );
  });

  it('usa valores seguros si faltan datos', () => {
    const converted = visitMaterialFromRow({ id: 'vm1', quantity: 'abc', observations: '' });
    expect(converted.quantity).toBe(0);
    expect(converted.observations).toBeNull();
    expect(converted.syncStatus).toBe('local');
  });
});

describe('visitMaterialFromRow: material personalizado', () => {
  it('sin material_id y con is_custom = 1', () => {
    expect(
      visitMaterialFromRow({
        id: 'vm9',
        visit_id: 'v1',
        material_id: null,
        is_custom: 1,
        material_code: 'PERSONALIZADO',
        material_name: 'Abrazadera',
        unit: 'bolsa',
        quantity: 2,
      }),
    ).toMatchObject({ materialId: null, isCustom: true, materialName: 'Abrazadera' });
    expect(visitMaterialFromRow({ id: 'vm1', material_id: 'm1' }).isCustom).toBe(false);
  });
});

describe('summarizeMaterials', () => {
  it('sin materiales devuelve conteo cero', () => {
    expect(summarizeMaterials([])).toEqual({
      count: 0,
      countLabel: '0 materiales',
      customCount: 0,
      customLabel: '',
      totals: [],
      totalsLabel: '',
    });
  });

  it('cuenta los materiales personalizados (singular y plural)', () => {
    const one = summarizeMaterials([material(), material({ id: 'vm2', isCustom: true })]);
    expect(one).toMatchObject({ customCount: 1, customLabel: '1 personalizado' });
    const two = summarizeMaterials([
      material({ isCustom: true }),
      material({ id: 'vm2', isCustom: true }),
    ]);
    expect(two.customLabel).toBe('2 personalizados');
  });

  it('usa singular con un material', () => {
    const summary = summarizeMaterials([material({ quantity: 12.5 })]);
    expect(summary.countLabel).toBe('1 material');
    expect(summary.totalsLabel).toBe('12,5 metro');
  });

  it('agrupa los totales por unidad y no suma unidades distintas', () => {
    const summary = summarizeMaterials([
      material({ id: 'a', unit: 'metro', quantity: 100 }),
      material({ id: 'b', unit: 'unidad', quantity: 4 }),
      material({ id: 'c', unit: 'metro', quantity: 20 }),
      material({ id: 'd', unit: 'unidad', quantity: 10 }),
    ]);

    expect(summary.count).toBe(4);
    expect(summary.countLabel).toBe('4 materiales');
    expect(summary.totals).toEqual([
      { unit: 'metro', quantity: 120 },
      { unit: 'unidad', quantity: 14 },
    ]);
    expect(summary.totalsLabel).toBe('120 metro · 14 unidad');
  });

  it('redondea los totales para evitar restos de coma flotante', () => {
    const summary = summarizeMaterials([
      material({ id: 'a', quantity: 0.1 }),
      material({ id: 'b', quantity: 0.2 }),
    ]);
    expect(summary.totals[0]?.quantity).toBe(0.3);
    expect(summary.totalsLabel).toBe('0,3 metro');
  });
});

describe('formatQuantityWithUnit', () => {
  it('une la cantidad formateada con la unidad', () => {
    expect(formatQuantityWithUnit(3, 'unidad')).toBe('3 unidad');
    expect(formatQuantityWithUnit(2.75, '')).toBe('2,75');
  });
});
