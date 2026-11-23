import {
  buildPurchaseSuggestions,
  formatSignedQuantity,
  isBelowMinimum,
  isPendingSyncStatus,
  materialConsumptionFromRow,
  materialStockItemFromRow,
  parseStockMovementKind,
  roundQuantity,
  stockMovementFromRow,
  suggestedPurchaseQuantity,
  type MaterialStockItem,
} from '../inventory.model';

const stockRow = (overrides: Record<string, unknown> = {}) => ({
  material_id: 'm1',
  code: 'CAB-01',
  name: 'Cable',
  unit: 'metro',
  category: 'Cableado',
  min_stock: 20,
  stock_id: 'm1',
  purchased: 30,
  adjusted: -2,
  used: 15.5,
  on_hand: 12.5,
  pending_movements: 0,
  pending_uses: 0,
  ...overrides,
});

describe('materialStockItemFromRow', () => {
  it('convierte la fila con existencias y marca bajo mínimo', () => {
    expect(materialStockItemFromRow(stockRow())).toEqual({
      materialId: 'm1',
      code: 'CAB-01',
      name: 'Cable',
      unit: 'metro',
      category: 'Cableado',
      minStock: 20,
      stock: { purchased: 30, adjusted: -2, used: 15.5, onHand: 12.5 },
      needsInitialCount: false,
      isNegative: false,
      isLow: true,
      pendingMovements: 0,
      pendingUses: 0,
      hasPending: false,
    });
  });

  it('sin fila de existencias no inventa un cero: stock es null y no está bajo mínimo', () => {
    const item = materialStockItemFromRow(
      stockRow({ stock_id: null, purchased: null, adjusted: null, used: null, on_hand: null }),
    );
    expect(item.stock).toBeNull();
    expect(item.isLow).toBe(false);
  });

  it('sin mínimo no está bajo mínimo; los pendientes se suman', () => {
    const item = materialStockItemFromRow(
      stockRow({ min_stock: null, category: '  ', pending_movements: 1, pending_uses: 2 }),
    );
    expect(item.minStock).toBeNull();
    expect(item.category).toBeNull();
    expect(item.isLow).toBe(false);
    expect(item.hasPending).toBe(true);
  });

  it('tolera valores raros', () => {
    const item = materialStockItemFromRow({ material_id: 5, stock_id: 'x', on_hand: 'abc' });
    expect(item.materialId).toBe('5');
    expect(item.stock?.onHand).toBe(0);
    expect(item.minStock).toBeNull();
    expect(item.code).toBe('');
  });
});

describe('reglas', () => {
  const item = (onHand: number | null, minStock: number | null): MaterialStockItem =>
    materialStockItemFromRow(
      stockRow({
        stock_id: onHand === null ? null : 'm1',
        on_hand: onHand,
        min_stock: minStock,
      }),
    );

  it('isBelowMinimum solo con ambos valores y estrictamente menor', () => {
    expect(isBelowMinimum({ purchased: 0, adjusted: 0, used: 0, onHand: 5 }, 5)).toBe(false);
    expect(isBelowMinimum({ purchased: 0, adjusted: 0, used: 0, onHand: 4.999 }, 5)).toBe(true);
    expect(isBelowMinimum(null, 5)).toBe(false);
    expect(isBelowMinimum({ purchased: 0, adjusted: 0, used: 0, onHand: -1 }, null)).toBe(false);
  });

  it('sugiere lo que falta para el mínimo, redondeado hacia arriba a enteros', () => {
    expect(suggestedPurchaseQuantity(item(12.5, 20))).toBe(8);
    expect(suggestedPurchaseQuantity(item(-3, 10))).toBe(13);
    expect(suggestedPurchaseQuantity(item(0.7, 1))).toBe(1);
    // 0,1 + 0,2 no deja restos: falta exactamente 2.
    expect(suggestedPurchaseQuantity(item(0.30000000000000004, 2.3))).toBe(2);
    expect(suggestedPurchaseQuantity(item(20, 20))).toBeNull();
    expect(suggestedPurchaseQuantity(item(null, 20))).toBeNull();
    expect(suggestedPurchaseQuantity(item(5, null))).toBeNull();
  });

  it('buildPurchaseSuggestions conserva el orden y omite lo que no hace falta comprar', () => {
    const low = item(1, 5);
    const ok = item(10, 5);
    expect(buildPurchaseSuggestions([low, ok])).toEqual([{ item: low, suggestedQuantity: 4 }]);
  });

  it('formatea cantidades con signo y redondea a 3 decimales', () => {
    expect(formatSignedQuantity(10)).toBe('+10');
    expect(formatSignedQuantity(-2.5)).toBe('−2,5');
    expect(formatSignedQuantity(0)).toBe('0');
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
  });
});

describe('movimientos y consumo', () => {
  it('convierte un movimiento y detecta si está pendiente', () => {
    expect(
      stockMovementFromRow({
        id: 'mv1',
        material_id: 'm1',
        kind: 'adjustment',
        quantity: -3,
        note: ' ',
        created_by: 'u1',
        sync_status: 'pendingSync',
        created_at: '2026-06-01T09:00:00.000Z',
      }),
    ).toEqual({
      id: 'mv1',
      materialId: 'm1',
      kind: 'adjustment',
      quantity: -3,
      note: null,
      createdBy: 'u1',
      createdAt: '2026-06-01T09:00:00.000Z',
      isPending: true,
    });
    expect(stockMovementFromRow({ kind: 'otro', sync_status: 'synced' })).toMatchObject({
      kind: 'purchase',
      isPending: false,
      createdBy: null,
    });
  });

  it('estados pendientes', () => {
    expect(['local', 'pendingSync', 'syncing'].every(isPendingSyncStatus)).toBe(true);
    expect(isPendingSyncStatus('synced')).toBe(false);
    expect(isPendingSyncStatus('syncError')).toBe(false);
    expect(parseStockMovementKind('adjustment')).toBe('adjustment');
  });

  it('convierte el consumo', () => {
    expect(
      materialConsumptionFromRow({
        material_id: 'm1',
        code: 'C',
        name: 'Cable',
        unit: 'metro',
        quantity: 0.1 + 0.2,
        visit_count: 2,
      }),
    ).toEqual({
      materialId: 'm1',
      code: 'C',
      name: 'Cable',
      unit: 'metro',
      quantity: 0.3,
      visitCount: 2,
    });
  });
});
