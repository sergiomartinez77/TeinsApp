import {
  INVENTORY_MESSAGES,
  minStockSchema,
  minStockValueError,
  movementQuantityError,
  stockMovementSchema,
} from '../validation';

const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);

describe('stockMovementSchema', () => {
  it('acepta una compra con coma decimal y recorta la nota', () => {
    expect(
      stockMovementSchema.parse({ kind: 'purchase', quantity: '12,5', note: '  Factura  ' }),
    ).toEqual({ kind: 'purchase', quantity: 12.5, note: 'Factura' });
  });

  it('acepta un ajuste negativo y la nota vacía queda en null', () => {
    expect(stockMovementSchema.parse({ kind: 'adjustment', quantity: '-3', note: ' ' })).toEqual({
      kind: 'adjustment',
      quantity: -3,
      note: null,
    });
  });

  it.each([
    ['purchase', '', INVENTORY_MESSAGES.quantityRequired],
    ['purchase', 'abc', INVENTORY_MESSAGES.invalidNumber],
    ['purchase', '0', INVENTORY_MESSAGES.purchasePositive],
    ['purchase', '-1', INVENTORY_MESSAGES.purchasePositive],
    ['adjustment', '0', INVENTORY_MESSAGES.adjustmentNonZero],
    ['purchase', '1,2345', INVENTORY_MESSAGES.maxDecimals],
    ['adjustment', '-1000000000', INVENTORY_MESSAGES.quantityTooLarge],
  ] as const)('%s "%s" → error', (kind, quantity, message) => {
    expect(issues(stockMovementSchema.safeParse({ kind, quantity, note: '' }))).toEqual([message]);
  });

  it('rechaza una nota de más de 500 caracteres', () => {
    expect(
      issues(
        stockMovementSchema.safeParse({ kind: 'purchase', quantity: '1', note: 'x'.repeat(501) }),
      ),
    ).toEqual([INVENTORY_MESSAGES.noteTooLong]);
  });

  it('movementQuantityError rechaza valores no finitos', () => {
    expect(movementQuantityError('purchase', Number.NaN)).toBe(INVENTORY_MESSAGES.invalidNumber);
    expect(movementQuantityError('adjustment', 2)).toBeNull();
  });
});

describe('minStockSchema', () => {
  it('vacío = sin mínimo; acepta cero y decimales', () => {
    expect(minStockSchema.parse({ minStock: ' ' })).toEqual({ minStock: null });
    expect(minStockSchema.parse({ minStock: '0' })).toEqual({ minStock: 0 });
    expect(minStockSchema.parse({ minStock: '2,5' })).toEqual({ minStock: 2.5 });
  });

  it.each([
    ['-1', INVENTORY_MESSAGES.minStockNegative],
    ['x', INVENTORY_MESSAGES.invalidNumber],
    ['1,0001', INVENTORY_MESSAGES.maxDecimals],
    ['1000000000', INVENTORY_MESSAGES.quantityTooLarge],
  ])('"%s" → error', (minStock, message) => {
    expect(issues(minStockSchema.safeParse({ minStock }))).toEqual([message]);
  });

  it('minStockValueError rechaza valores no finitos', () => {
    expect(minStockValueError(Number.POSITIVE_INFINITY)).toBe(INVENTORY_MESSAGES.invalidNumber);
  });
});
