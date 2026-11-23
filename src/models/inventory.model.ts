import { formatQuantity } from '@/utils/number.utils';

/**
 * Inventario de la bodega (una sola bodega de la empresa).
 *
 * Las existencias (`material_stock`) las calcula el SERVIDOR con triggers:
 * compras + ajustes − uso en visitas. La app las muestra tal cual llegaron en
 * la última sincronización; nunca las recalcula ni inventa un valor. Lo que
 * aún no se subió (movimientos o usos registrados en este dispositivo) se
 * marca como "pendiente de sincronizar".
 */

// ── Entidades ────────────────────────────────────────────────────────────────

export type StockMovementKind = 'purchase' | 'adjustment';

export const STOCK_MOVEMENT_KINDS: readonly StockMovementKind[] = ['purchase', 'adjustment'];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementKind, string> = {
  purchase: 'Compra',
  adjustment: 'Ajuste',
};

/** Existencias calculadas por el servidor. */
export interface StockLevels {
  readonly purchased: number;
  readonly adjusted: number;
  readonly used: number;
  readonly onHand: number;
}

/** Material del catálogo con sus existencias en bodega. */
export interface MaterialStockItem {
  readonly materialId: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly category: string | null;
  /** Mínimo en bodega; `null` = sin mínimo definido. */
  readonly minStock: number | null;
  /** `null` = todavía no llegaron las existencias del servidor a este dispositivo. */
  readonly stock: StockLevels | null;
  /** Existencias por debajo del mínimo (solo si se conocen ambos valores). */
  readonly isLow: boolean;
  /** Compras/ajustes registrados aquí que aún no llegaron al servidor. */
  readonly pendingMovements: number;
  /** Usos en visitas registrados aquí que aún no llegaron al servidor. */
  readonly pendingUses: number;
  /** Hay cambios locales que las existencias mostradas todavía no incluyen. */
  readonly hasPending: boolean;
}

/** Compra o ajuste de bodega. */
export interface StockMovement {
  readonly id: string;
  readonly materialId: string;
  readonly kind: StockMovementKind;
  readonly quantity: number;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  /** Registrado en este dispositivo y aún sin subir. */
  readonly isPending: boolean;
}

/** Sugerencia de compra para un material bajo mínimo. */
export interface PurchaseSuggestion {
  readonly item: MaterialStockItem;
  /** Cantidad para volver al mínimo, redondeada hacia arriba a unidades enteras. */
  readonly suggestedQuantity: number;
}

/** Consumo de un material del catálogo en un rango de fechas. */
export interface MaterialConsumption {
  readonly materialId: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly quantity: number;
  /** Visitas distintas en las que se usó. */
  readonly visitCount: number;
}

// ── Conversión desde SQLite ──────────────────────────────────────────────────

const text = (value: unknown): string =>
  typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

const optionalText = (value: unknown): string | null => {
  const result = text(value).trim();
  return result.length > 0 ? result : null;
};

/** Número o `null` si falta o no es válido (nunca se inventa un cero). */
const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

const toNumber = (value: unknown): number => optionalNumber(value) ?? 0;

/** Redondeo a 3 decimales (NUMERIC(…, 3) del servidor) para evitar restos de coma flotante. */
export const roundQuantity = (value: number): number => Math.round(value * 1000) / 1000;

export function parseStockMovementKind(value: unknown): StockMovementKind {
  return value === 'adjustment' ? 'adjustment' : 'purchase';
}

const PENDING_SYNC_STATES: ReadonlySet<unknown> = new Set(['local', 'pendingSync', 'syncing']);

/** ¿El `sync_status` local indica que la fila aún no se subió? */
export function isPendingSyncStatus(value: unknown): boolean {
  return PENDING_SYNC_STATES.has(value);
}

/**
 * Fila de la consulta de existencias (catálogo + material_stock + pendientes).
 * Si la fila de existencias no llegó (`stock_id` NULL), `stock` es `null`.
 */
export function materialStockItemFromRow(row: Record<string, unknown>): MaterialStockItem {
  const hasStock = optionalText(row.stock_id) !== null;
  const stock: StockLevels | null = hasStock
    ? {
        purchased: toNumber(row.purchased),
        adjusted: toNumber(row.adjusted),
        used: toNumber(row.used),
        onHand: toNumber(row.on_hand),
      }
    : null;
  const minStock = optionalNumber(row.min_stock);
  const pendingMovements = toNumber(row.pending_movements);
  const pendingUses = toNumber(row.pending_uses);

  return {
    materialId: text(row.material_id),
    code: text(row.code),
    name: text(row.name),
    unit: text(row.unit),
    category: optionalText(row.category),
    minStock,
    stock,
    isLow: isBelowMinimum(stock, minStock),
    pendingMovements,
    pendingUses,
    hasPending: pendingMovements + pendingUses > 0,
  };
}

export function stockMovementFromRow(row: Record<string, unknown>): StockMovement {
  return {
    id: text(row.id),
    materialId: text(row.material_id),
    kind: parseStockMovementKind(row.kind),
    quantity: toNumber(row.quantity),
    note: optionalText(row.note),
    createdBy: optionalText(row.created_by),
    createdAt: text(row.created_at),
    isPending: isPendingSyncStatus(row.sync_status),
  };
}

export function materialConsumptionFromRow(row: Record<string, unknown>): MaterialConsumption {
  return {
    materialId: text(row.material_id),
    code: text(row.code),
    name: text(row.name),
    unit: text(row.unit),
    quantity: roundQuantity(toNumber(row.quantity)),
    visitCount: toNumber(row.visit_count),
  };
}

// ── Reglas ───────────────────────────────────────────────────────────────────

/** Bajo mínimo: existencias conocidas y estrictamente menores que el mínimo. */
export function isBelowMinimum(stock: StockLevels | null, minStock: number | null): boolean {
  return stock !== null && minStock !== null && stock.onHand < minStock;
}

/**
 * Cantidad sugerida para comprar: lo que falta para llegar al mínimo,
 * redondeado hacia arriba a unidades enteras (no se compran 2,3 conectores
 * ni 0,4 rollos; en metros, se pide el metro completo). `null` si no hace
 * falta comprar o no se conocen las existencias.
 */
export function suggestedPurchaseQuantity(item: MaterialStockItem): number | null {
  if (!item.isLow || item.stock === null || item.minStock === null) return null;
  const missing = roundQuantity(item.minStock - item.stock.onHand);
  return missing > 0 ? Math.ceil(missing) : null;
}

/** Sugerencias de compra de los materiales bajo mínimo, en el mismo orden. */
export function buildPurchaseSuggestions(
  items: readonly MaterialStockItem[],
): PurchaseSuggestion[] {
  const suggestions: PurchaseSuggestion[] = [];
  for (const item of items) {
    const suggestedQuantity = suggestedPurchaseQuantity(item);
    if (suggestedQuantity !== null) suggestions.push({ item, suggestedQuantity });
  }
  return suggestions;
}

/** Signo con el que el movimiento cambia las existencias, para mostrarlo ("+10", "−2,5"). */
export function formatSignedQuantity(quantity: number): string {
  if (quantity > 0) return `+${formatQuantity(quantity)}`;
  if (quantity < 0) return `−${formatQuantity(-quantity)}`;
  return '0';
}
