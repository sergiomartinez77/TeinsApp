import {
  buildPurchaseSuggestions,
  materialConsumptionFromRow,
  materialStockItemFromRow,
  roundQuantity,
  stockMovementFromRow,
  type MaterialConsumption,
  type MaterialStockItem,
  type PurchaseSuggestion,
  type StockMovement,
} from '@/models/inventory.model';
import { canEditMinStock, canManageInventory, type UserProfile } from '@/models/user.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

import {
  minStockValueError,
  movementQuantityError,
  STOCK_NOTE_MAX_LENGTH,
  INVENTORY_MESSAGES,
  type StockMovementInput,
} from '../validation';

import {
  ACTIVE_CATALOG_MATERIAL_SQL,
  buildStockQuery,
  CONSUMPTION_SQL,
  INSERT_STOCK_MOVEMENT_SQL,
  MOVEMENT_HISTORY_SQL,
  UPDATE_MIN_STOCK_SQL,
} from './inventory.queries';

/**
 * API del inventario sobre la base local.
 *
 * Las funciones de lectura son puras sobre la interfaz `InventoryReader`
 * (subconjunto de PowerSync): sirven igual para las pantallas, los tests y un
 * futuro asistente (chatbot) que consulte el inventario. No escriben nada.
 */

const log = scopedLogger('inventory');

/** Lectura de la base (subconjunto de PowerSync). */
export interface InventoryReader {
  getAll: <T>(sql: string, parameters?: unknown[]) => Promise<T[]>;
}

export interface InventoryTransaction {
  execute: (sql: string, parameters?: unknown[]) => Promise<unknown>;
  getOptional: <T>(sql: string, parameters?: unknown[]) => Promise<T | null>;
}

export interface InventoryWriter {
  writeTransaction: <T>(callback: (tx: InventoryTransaction) => Promise<T>) => Promise<T>;
}

export const INVENTORY_SERVICE_MESSAGES = {
  forbiddenMovement: 'Solo administración u oficina pueden registrar compras y ajustes.',
  forbiddenMinStock: 'Solo un administrador puede cambiar el mínimo de bodega.',
  materialUnavailable: 'Este material ya no está disponible en el catálogo.',
} as const;

// ── Lectura ──────────────────────────────────────────────────────────────────

export interface StockSummaryOptions {
  /** Texto libre: código o nombre. */
  search?: string;
  /** Máximo de materiales. */
  limit?: number;
}

/** Existencias de los materiales activos (primero los bajo mínimo, luego por nombre). */
export async function getStockSummary(
  db: InventoryReader,
  options: StockSummaryOptions = {},
): Promise<MaterialStockItem[]> {
  const query = buildStockQuery({ search: options.search, limit: options.limit });
  const rows = await db.getAll<Record<string, unknown>>(query.sql, query.parameters);
  return rows.map(materialStockItemFromRow);
}

/** Materiales cuyas existencias están por debajo de su mínimo. */
export async function getLowStock(db: InventoryReader): Promise<MaterialStockItem[]> {
  const query = buildStockQuery({ onlyLow: true });
  const rows = await db.getAll<Record<string, unknown>>(query.sql, query.parameters);
  return rows.map(materialStockItemFromRow);
}

/** "Qué comprar": materiales bajo mínimo con la cantidad sugerida para reponerlos. */
export async function getPurchaseSuggestions(db: InventoryReader): Promise<PurchaseSuggestion[]> {
  return buildPurchaseSuggestions(await getLowStock(db));
}

/** Existencias de un material activo, o `null` si no está en el catálogo. */
export async function getMaterialStock(
  db: InventoryReader,
  materialId: string,
): Promise<MaterialStockItem | null> {
  const query = buildStockQuery({ materialId, limit: 1 });
  const [row] = await db.getAll<Record<string, unknown>>(query.sql, query.parameters);
  return row ? materialStockItemFromRow(row) : null;
}

/** Compras y ajustes de un material, del más reciente al más antiguo. */
export async function getMovementHistory(
  db: InventoryReader,
  materialId: string,
  limit = 50,
): Promise<StockMovement[]> {
  const rows = await db.getAll<Record<string, unknown>>(MOVEMENT_HISTORY_SQL, [materialId, limit]);
  return rows.map(stockMovementFromRow);
}

export interface ConsumptionRange {
  /** Inicio (incluido): fecha o texto ISO 8601. */
  from: Date | string;
  /** Fin (incluido): fecha o texto ISO 8601. */
  to: Date | string;
}

const isoDate = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

/**
 * Consumo de cada material del catálogo en visitas del rango (por
 * `completed_at` o, si la visita no terminó, `created_at`).
 * Solo cuenta las visitas que hay en este dispositivo (ver CONSUMPTION_SQL).
 */
export async function getConsumption(
  db: InventoryReader,
  range: ConsumptionRange,
): Promise<MaterialConsumption[]> {
  const rows = await db.getAll<Record<string, unknown>>(CONSUMPTION_SQL, [
    isoDate(range.from),
    isoDate(range.to),
  ]);
  return rows.map(materialConsumptionFromRow);
}

// ── Escritura (admin / oficina) ──────────────────────────────────────────────

export interface RecordStockMovementInput extends StockMovementInput {
  materialId: string;
}

/** Señal interna para deshacer la transacción con un error ya tipado. */
class InventoryRuleError extends Error {
  constructor(readonly result: Result<never>) {
    super('inventory-rule');
  }
}

async function run<T>(
  db: InventoryWriter,
  failureMessage: string,
  callback: (tx: InventoryTransaction) => Promise<T>,
): Promise<Result<T>> {
  try {
    return ok(await db.writeTransaction(callback));
  } catch (error) {
    if (error instanceof InventoryRuleError) return error.result;
    log.error(failureMessage, error);
    return err(appError('database', { cause: error }));
  }
}

async function assertActiveMaterial(tx: InventoryTransaction, materialId: string): Promise<void> {
  const material = await tx.getOptional<Record<string, unknown>>(ACTIVE_CATALOG_MATERIAL_SQL, [
    materialId,
  ]);
  if (!material) {
    throw new InventoryRuleError(
      err(validationError(INVENTORY_SERVICE_MESSAGES.materialUnavailable, 'material_unavailable')),
    );
  }
}

/**
 * Registra una compra o un ajuste en la base local; se sube al servidor al
 * sincronizar (la RLS solo lo acepta de admin u oficina). Las existencias no
 * cambian en el dispositivo hasta que el servidor las recalcula y llegan.
 * Nunca lanza: los errores vuelven en el `Result`.
 */
export async function recordStockMovement(
  db: InventoryWriter,
  user: Pick<UserProfile, 'id' | 'role'>,
  input: RecordStockMovementInput,
  now: Date = new Date(),
): Promise<Result<StockMovement>> {
  if (!canManageInventory(user.role)) {
    return err(
      appError('unauthorized', {
        message: INVENTORY_SERVICE_MESSAGES.forbiddenMovement,
        code: 'forbidden',
      }),
    );
  }
  const quantityError = movementQuantityError(input.kind, input.quantity);
  if (quantityError) return err(validationError(quantityError, 'invalid_quantity'));
  const note = input.note?.trim() ?? '';
  if (note.length > STOCK_NOTE_MAX_LENGTH) {
    return err(validationError(INVENTORY_MESSAGES.noteTooLong, 'invalid_note'));
  }

  const timestamp = now.toISOString();
  const row: Record<string, unknown> = {
    id: generateId(),
    material_id: input.materialId,
    kind: input.kind,
    quantity: roundQuantity(input.quantity),
    note: note || null,
    created_by: user.id,
    sync_status: 'pendingSync',
    created_at: timestamp,
    updated_at: timestamp,
  };

  return run(db, 'No se pudo registrar el movimiento de bodega', async (tx) => {
    await assertActiveMaterial(tx, input.materialId);
    await tx.execute(INSERT_STOCK_MOVEMENT_SQL, [
      row.id,
      row.material_id,
      row.kind,
      row.quantity,
      row.note,
      row.created_by,
      row.sync_status,
      row.created_at,
      row.updated_at,
    ]);
    return stockMovementFromRow(row);
  });
}

export interface SetMinStockInput {
  materialId: string;
  /** `null` = quitar el mínimo. */
  minStock: number | null;
}

/** Cambia el mínimo de bodega de un material (solo admin; se sube al sincronizar). */
export async function setMinStock(
  db: InventoryWriter,
  user: Pick<UserProfile, 'role'>,
  input: SetMinStockInput,
): Promise<Result<void>> {
  if (!canEditMinStock(user.role)) {
    return err(
      appError('unauthorized', {
        message: INVENTORY_SERVICE_MESSAGES.forbiddenMinStock,
        code: 'forbidden',
      }),
    );
  }
  if (input.minStock !== null) {
    const error = minStockValueError(input.minStock);
    if (error) return err(validationError(error, 'invalid_min_stock'));
  }
  const minStock = input.minStock === null ? null : roundQuantity(input.minStock);

  return run(db, 'No se pudo cambiar el mínimo de bodega', async (tx) => {
    await assertActiveMaterial(tx, input.materialId);
    await tx.execute(UPDATE_MIN_STOCK_SQL, [minStock, input.materialId, minStock]);
  });
}
