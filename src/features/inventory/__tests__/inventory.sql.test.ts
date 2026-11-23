import {
  catalogRow,
  materialStockRow,
  stockMovementRow,
  visitMaterialRow,
  visitRow,
} from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import { buildStockQuery, PENDING_MOVEMENTS_COUNT_SQL } from '../services/inventory.queries';
import {
  getConsumption,
  getLowStock,
  getMaterialStock,
  getMovementHistory,
  getPurchaseSuggestions,
  getStockSummary,
  INVENTORY_SERVICE_MESSAGES,
  recordStockMovement,
  setMinStock,
} from '../services/inventory.service';
import { INVENTORY_MESSAGES } from '../validation';

/** Consultas y escrituras del inventario contra SQLite real. */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-10T12:00:00.000Z');
const OFFICE = { id: 'oficina', role: 'office' as const };
const ADMIN = { id: 'admin', role: 'admin' as const };
const TECH = { id: 'tecnico-a', role: 'technician' as const };

let db: TestDatabase;

beforeEach(() => {
  resetIds('mv');
  db = createTestDatabase();
  db.insert('material_catalog', [
    catalogRow({ id: 'm-cable', code: 'CAB-01', name: 'Cable UTP', unit: 'metro', min_stock: 100 }),
    catalogRow({ id: 'm-breaker', code: 'BRK-20', name: 'Breaker 20A', min_stock: 5 }),
    catalogRow({ id: 'm-brida', code: 'BRI-01', name: 'Brida', min_stock: null }),
    catalogRow({ id: 'm-canería', code: 'TUB-01', name: 'Cañería PVC', min_stock: 10 }),
    catalogRow({ id: 'm-nuevo', code: 'NEW-01', name: 'Ánodo nuevo', min_stock: 3 }),
    catalogRow({ id: 'm-viejo', code: 'OLD-01', name: 'Antiguo', is_active: 0, min_stock: 50 }),
  ]);
  db.insert('material_stock', [
    materialStockRow({ material_id: 'm-cable', purchased: 120, used: 70.5, on_hand: 49.5 }),
    materialStockRow({ material_id: 'm-breaker', purchased: 10, adjusted: -1, on_hand: 9 }),
    materialStockRow({ material_id: 'm-brida', used: 3, on_hand: -3 }),
    materialStockRow({ material_id: 'm-canería', purchased: 2, on_hand: 2 }),
    materialStockRow({ material_id: 'm-viejo', on_hand: 0 }),
    // m-nuevo: sus existencias aún no llegaron del servidor.
  ]);
});

const names = (items: { name: string }[]) => items.map((item) => item.name);

describe('existencias', () => {
  it('lista los activos: primero los bajo mínimo y luego por nombre', async () => {
    const items = await getStockSummary(db);
    // NOCASE solo pliega A–Z: "Ánodo" va detrás (igual que el catálogo de la visita).
    expect(names(items)).toEqual([
      'Cable UTP',
      'Cañería PVC',
      'Breaker 20A',
      'Brida',
      'Ánodo nuevo',
    ]);
    const cable = items[0];
    expect(cable).toMatchObject({
      isLow: true,
      minStock: 100,
      stock: { purchased: 120, adjusted: 0, used: 70.5, onHand: 49.5 },
      hasPending: false,
    });
    // Sin existencias sincronizadas: no se muestra un cero inventado.
    expect(items.find((item) => item.materialId === 'm-nuevo')?.stock).toBeNull();
    // Existencias negativas sin mínimo: no está "bajo mínimo".
    expect(items.find((item) => item.materialId === 'm-brida')).toMatchObject({
      isLow: false,
      stock: { onHand: -3 },
    });
  });

  it('busca por código o nombre, también con acentos, y respeta el límite', async () => {
    expect(names(await getStockSummary(db, { search: 'cañería' }))).toEqual(['Cañería PVC']);
    expect(names(await getStockSummary(db, { search: 'CAÑERÍA' }))).toEqual(['Cañería PVC']);
    expect(names(await getStockSummary(db, { search: 'brk' }))).toEqual(['Breaker 20A']);
    expect(names(await getStockSummary(db, { search: 'antiguo' }))).toEqual([]);
    expect(await getStockSummary(db, { limit: 2 })).toHaveLength(2);
  });

  it('bajo mínimo y "qué comprar" con la cantidad sugerida', async () => {
    expect(names(await getLowStock(db))).toEqual(['Cable UTP', 'Cañería PVC']);
    const suggestions = await getPurchaseSuggestions(db);
    expect(
      suggestions.map((suggestion) => [suggestion.item.materialId, suggestion.suggestedQuantity]),
    ).toEqual([
      ['m-cable', 51],
      ['m-canería', 8],
    ]);
  });

  it('el filtro onlyLow se combina con la búsqueda', async () => {
    const query = buildStockQuery({ search: 'cable', onlyLow: true });
    expect(await db.getAll<Row>(query.sql, query.parameters)).toHaveLength(1);
  });

  it('existencias de un material; null si no está activo o no existe', async () => {
    expect(await getMaterialStock(db, 'm-breaker')).toMatchObject({
      name: 'Breaker 20A',
      stock: { adjusted: -1, onHand: 9 },
    });
    expect(await getMaterialStock(db, 'm-viejo')).toBeNull();
    expect(await getMaterialStock(db, 'no-existe')).toBeNull();
  });

  it('marca lo pendiente de sincronizar: movimientos y usos del catálogo (no personalizados)', async () => {
    db.insert('visits', [visitRow({ id: 'v1' })]);
    db.insert('material_stock_movements', [
      stockMovementRow({ id: 'mv-a', material_id: 'm-cable', sync_status: 'pendingSync' }),
      stockMovementRow({ id: 'mv-b', material_id: 'm-cable', sync_status: 'synced' }),
    ]);
    db.insert('visit_materials', [
      visitMaterialRow({ id: 'vm-1', material_id: 'm-breaker', sync_status: 'pendingSync' }),
      visitMaterialRow({ id: 'vm-2', material_id: 'm-brida', sync_status: 'synced' }),
      visitMaterialRow({
        id: 'vm-3',
        material_id: null,
        is_custom: 1,
        material_name: 'Personalizado',
        sync_status: 'pendingSync',
      }),
    ]);

    const byId = new Map((await getStockSummary(db)).map((item) => [item.materialId, item]));
    expect(byId.get('m-cable')).toMatchObject({ pendingMovements: 1, hasPending: true });
    expect(byId.get('m-breaker')).toMatchObject({ pendingUses: 1, hasPending: true });
    expect(byId.get('m-brida')?.hasPending).toBe(false);
    expect(await db.get(PENDING_MOVEMENTS_COUNT_SQL)).toEqual({ count: 1 });
  });
});

describe('historial', () => {
  it('del más reciente al más antiguo, con límite', async () => {
    db.insert('material_stock_movements', [
      stockMovementRow({ id: 'mv-1', created_at: '2026-06-01T09:00:00.000Z' }),
      stockMovementRow({
        id: 'mv-2',
        kind: 'adjustment',
        quantity: -2,
        created_at: '2026-06-03T09:00:00.000Z',
      }),
      stockMovementRow({ id: 'mv-3', created_at: '2026-06-02T09:00:00.000Z' }),
      stockMovementRow({ id: 'mv-x', material_id: 'otro' }),
    ]);
    const history = await getMovementHistory(db, 'm1');
    expect(history.map((movement) => movement.id)).toEqual(['mv-2', 'mv-3', 'mv-1']);
    expect(history[0]).toMatchObject({ kind: 'adjustment', quantity: -2, isPending: false });
    expect(await getMovementHistory(db, 'm1', 1)).toHaveLength(1);
  });
});

describe('consumo por rango de fechas', () => {
  beforeEach(() => {
    db.insert('visits', [
      // Terminada en junio: cuenta por completed_at.
      visitRow({
        id: 'v-jun',
        status: 'completed',
        created_at: '2026-05-20T08:00:00.000Z',
        completed_at: '2026-06-05T17:00:00.000Z',
      }),
      // Sin terminar: cuenta por created_at (formato del servidor, con espacio).
      visitRow({ id: 'v-abierta', status: 'inProgress', created_at: '2026-06-07 10:00:00.000Z' }),
      // Fuera del rango.
      visitRow({ id: 'v-mayo', created_at: '2026-05-01T08:00:00.000Z' }),
    ]);
    db.insert('visit_materials', [
      visitMaterialRow({ id: 'a', visit_id: 'v-jun', material_id: 'm-cable', quantity: 12.5 }),
      visitMaterialRow({ id: 'b', visit_id: 'v-abierta', material_id: 'm-cable', quantity: 7.5 }),
      visitMaterialRow({ id: 'c', visit_id: 'v-abierta', material_id: 'm-breaker', quantity: 2 }),
      visitMaterialRow({ id: 'd', visit_id: 'v-mayo', material_id: 'm-cable', quantity: 100 }),
      visitMaterialRow({
        id: 'e',
        visit_id: 'v-jun',
        material_id: null,
        is_custom: 1,
        material_name: 'Cinta',
        quantity: 50,
      }),
      // Material que ya no está activo: usa la copia guardada en la visita.
      visitMaterialRow({
        id: 'f',
        visit_id: 'v-jun',
        material_id: 'borrado',
        material_code: 'DEL-01',
        material_name: 'Retirado',
        quantity: 1,
      }),
    ]);
  });

  it('suma por material del catálogo, sin personalizados, ordenado por cantidad', async () => {
    const consumption = await getConsumption(db, {
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: '2026-06-30T23:59:59.999Z',
    });
    expect(consumption).toEqual([
      {
        materialId: 'm-cable',
        code: 'CAB-01',
        name: 'Cable UTP',
        unit: 'metro',
        quantity: 20,
        visitCount: 2,
      },
      {
        materialId: 'm-breaker',
        code: 'BRK-20',
        name: 'Breaker 20A',
        unit: 'unidad',
        quantity: 2,
        visitCount: 1,
      },
      {
        materialId: 'borrado',
        code: 'DEL-01',
        name: 'Retirado',
        unit: 'unidad',
        quantity: 1,
        visitCount: 1,
      },
    ]);
  });

  it('el rango incluye sus extremos y excluye lo de fuera', async () => {
    const onlyOpen = await getConsumption(db, {
      from: '2026-06-07T10:00:00.000Z',
      to: '2026-06-07T10:00:00.000Z',
    });
    expect(onlyOpen.map((row) => [row.materialId, row.quantity])).toEqual([
      ['m-cable', 7.5],
      ['m-breaker', 2],
    ]);
    expect(await getConsumption(db, { from: '2027-01-01', to: '2027-12-31' })).toEqual([]);
  });
});

describe('recordStockMovement', () => {
  it('oficina registra una compra: queda pendiente y las existencias NO cambian localmente', async () => {
    const result = await recordStockMovement(
      db,
      OFFICE,
      { materialId: 'm-cable', kind: 'purchase', quantity: 50, note: '  Factura 12 ' },
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        id: 'mv-1',
        materialId: 'm-cable',
        kind: 'purchase',
        quantity: 50,
        note: 'Factura 12',
        createdBy: 'oficina',
        createdAt: NOW.toISOString(),
        isPending: true,
      },
    });
    expect(db.rows('material_stock_movements')).toEqual([
      {
        id: 'mv-1',
        material_id: 'm-cable',
        kind: 'purchase',
        quantity: 50,
        note: 'Factura 12',
        created_by: 'oficina',
        sync_status: 'pendingSync',
        created_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
      },
    ]);
    const cable = await getMaterialStock(db, 'm-cable');
    expect(cable?.stock?.onHand).toBe(49.5);
    expect(cable?.hasPending).toBe(true);
  });

  it('admin registra un ajuste negativo con 3 decimales', async () => {
    const result = await recordStockMovement(db, ADMIN, {
      materialId: 'm-breaker',
      kind: 'adjustment',
      quantity: -1.125,
      note: null,
    });
    expect(result.ok).toBe(true);
    expect(db.rows('material_stock_movements')[0]).toMatchObject({
      kind: 'adjustment',
      quantity: -1.125,
      note: null,
      created_by: 'admin',
    });
  });

  it('el técnico no puede registrar movimientos', async () => {
    const result = await recordStockMovement(db, TECH, {
      materialId: 'm-cable',
      kind: 'purchase',
      quantity: 1,
      note: null,
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'unauthorized',
        message: INVENTORY_SERVICE_MESSAGES.forbiddenMovement,
      }),
    });
    expect(db.rows('material_stock_movements')).toEqual([]);
  });

  it.each([
    ['compra de 0', 'purchase', 0, INVENTORY_MESSAGES.purchasePositive],
    ['compra negativa', 'purchase', -1, INVENTORY_MESSAGES.purchasePositive],
    ['ajuste de 0', 'adjustment', 0, INVENTORY_MESSAGES.adjustmentNonZero],
    ['4 decimales', 'purchase', 1.2345, INVENTORY_MESSAGES.maxDecimals],
  ] as const)('rechaza %s', async (_label, kind, quantity, message) => {
    const result = await recordStockMovement(db, OFFICE, {
      materialId: 'm-cable',
      kind,
      quantity,
      note: null,
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ message }) });
    expect(db.rows('material_stock_movements')).toEqual([]);
  });

  it('rechaza una nota demasiado larga y un material inactivo', async () => {
    const long = await recordStockMovement(db, OFFICE, {
      materialId: 'm-cable',
      kind: 'purchase',
      quantity: 1,
      note: 'x'.repeat(501),
    });
    expect(long).toEqual({
      ok: false,
      error: expect.objectContaining({ message: INVENTORY_MESSAGES.noteTooLong }),
    });

    const inactive = await recordStockMovement(db, OFFICE, {
      materialId: 'm-viejo',
      kind: 'purchase',
      quantity: 1,
      note: null,
    });
    expect(inactive).toEqual({
      ok: false,
      error: expect.objectContaining({ message: INVENTORY_SERVICE_MESSAGES.materialUnavailable }),
    });
    expect(db.rows('material_stock_movements')).toEqual([]);
  });

  it('un fallo de la base se devuelve como error, sin lanzar', async () => {
    const broken = {
      writeTransaction: async () => {
        throw new Error('disco lleno');
      },
    };
    const result = await recordStockMovement(broken, OFFICE, {
      materialId: 'm-cable',
      kind: 'purchase',
      quantity: 1,
      note: null,
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: 'database' }) });
  });
});

describe('setMinStock', () => {
  const minStockOf = (id: string) =>
    db.rows('material_catalog').find((row) => row.id === id)?.min_stock;

  it('el admin cambia y quita el mínimo', async () => {
    expect(await setMinStock(db, ADMIN, { materialId: 'm-brida', minStock: 12.5 })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(minStockOf('m-brida')).toBe(12.5);
    // La brida nunca tuvo compras ni ajustes: falta su conteo inicial y, aunque
    // su "en bodega" (−3) es menor que el mínimo, no se marca bajo mínimo.
    expect(await getMaterialStock(db, 'm-brida')).toMatchObject({
      needsInitialCount: true,
      isLow: false,
    });

    await setMinStock(db, ADMIN, { materialId: 'm-brida', minStock: null });
    expect(minStockOf('m-brida')).toBeNull();
  });

  it('si el valor no cambia no escribe (no encola una subida vacía)', async () => {
    const before = db.getVersion();
    expect((await setMinStock(db, ADMIN, { materialId: 'm-cable', minStock: 100 })).ok).toBe(true);
    expect(db.getVersion()).toBe(before);
  });

  it('oficina y técnico no pueden; valores inválidos y materiales inactivos se rechazan', async () => {
    for (const user of [OFFICE, TECH]) {
      const result = await setMinStock(db, user, { materialId: 'm-cable', minStock: 1 });
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ message: INVENTORY_SERVICE_MESSAGES.forbiddenMinStock }),
      });
    }
    expect(await setMinStock(db, ADMIN, { materialId: 'm-cable', minStock: -1 })).toEqual({
      ok: false,
      error: expect.objectContaining({ message: INVENTORY_MESSAGES.minStockNegative }),
    });
    expect(await setMinStock(db, ADMIN, { materialId: 'm-viejo', minStock: 1 })).toEqual({
      ok: false,
      error: expect.objectContaining({ message: INVENTORY_SERVICE_MESSAGES.materialUnavailable }),
    });
    expect(minStockOf('m-cable')).toBe(100);
    expect(minStockOf('m-viejo')).toBe(50);
  });
});
