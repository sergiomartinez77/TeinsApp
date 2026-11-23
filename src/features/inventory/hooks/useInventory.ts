import { useQuery } from '@powersync/react';
import { useCallback, useMemo } from 'react';

import {
  buildPurchaseSuggestions,
  materialStockItemFromRow,
  stockMovementFromRow,
  type MaterialStockItem,
  type PurchaseSuggestion,
  type StockMovement,
} from '@/models/inventory.model';

import { buildStockQuery, MOVEMENT_HISTORY_SQL } from '../services/inventory.queries';

export interface InventoryFilters {
  search: string;
  /** Solo los materiales bajo mínimo. */
  onlyLow: boolean;
}

export interface InventoryResult {
  /** Materiales filtrados (primero los bajo mínimo). */
  items: MaterialStockItem[];
  /** "Qué comprar": TODOS los bajo mínimo, sin importar la búsqueda. */
  suggestions: PurchaseSuggestion[];
  /** Algún material tiene cambios de este dispositivo aún sin subir. */
  hasPending: boolean;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => void;
}

/**
 * Existencias de la bodega, reactivas: la lista cambia sola cuando llegan
 * del servidor existencias nuevas o se registra un movimiento.
 */
export function useInventory(filters: InventoryFilters): InventoryResult {
  const listQuery = useMemo(
    () => buildStockQuery({ search: filters.search, onlyLow: filters.onlyLow }),
    [filters.search, filters.onlyLow],
  );
  const lowQuery = useMemo(() => buildStockQuery({ onlyLow: true }), []);

  const list = useQuery<Record<string, unknown>>(listQuery.sql, listQuery.parameters);
  const low = useQuery<Record<string, unknown>>(lowQuery.sql, lowQuery.parameters);

  const items = useMemo(() => list.data.map(materialStockItemFromRow), [list.data]);
  const suggestions = useMemo(
    () => buildPurchaseSuggestions(low.data.map(materialStockItemFromRow)),
    [low.data],
  );

  const refreshList = list.refresh;
  const refreshLow = low.refresh;
  const refresh = useCallback(() => {
    void Promise.all([refreshList?.(), refreshLow?.()]).catch(() => undefined);
  }, [refreshList, refreshLow]);

  return {
    items,
    suggestions,
    hasPending: items.some((item) => item.hasPending),
    isLoading: list.isLoading || low.isLoading,
    hasError: Boolean(list.error ?? low.error),
    refresh,
  };
}

export interface MaterialStockDetail {
  item: MaterialStockItem | null;
  movements: StockMovement[];
  isLoading: boolean;
  hasError: boolean;
}

/** Máximo de movimientos que muestra el detalle. */
export const MOVEMENT_HISTORY_LIMIT = 50;

/** Existencias e historial de compras y ajustes de un material, reactivos. */
export function useMaterialStock(materialId: string): MaterialStockDetail {
  const stockQuery = useMemo(() => buildStockQuery({ materialId, limit: 1 }), [materialId]);
  const stock = useQuery<Record<string, unknown>>(stockQuery.sql, stockQuery.parameters);
  const history = useQuery<Record<string, unknown>>(MOVEMENT_HISTORY_SQL, [
    materialId,
    MOVEMENT_HISTORY_LIMIT,
  ]);

  const item = useMemo(() => {
    const [row] = stock.data;
    return row ? materialStockItemFromRow(row) : null;
  }, [stock.data]);
  const movements = useMemo(() => history.data.map(stockMovementFromRow), [history.data]);

  return {
    item,
    movements,
    isLoading: stock.isLoading || history.isLoading,
    hasError: Boolean(stock.error ?? history.error),
  };
}
