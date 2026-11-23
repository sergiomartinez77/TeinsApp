import { useQuery } from '@powersync/react';
import { useCallback, useMemo } from 'react';

import {
  buildPurchaseSuggestions,
  isRelevantWithoutCount,
  materialStockItemFromRow,
  stockMovementFromRow,
  type MaterialStockItem,
  type MaterialUsageByVisit,
  type PurchaseSuggestion,
  type StockMovement,
} from '@/models/inventory.model';

import {
  buildStockQuery,
  MATERIAL_USAGE_BY_VISIT_SQL,
  MATERIAL_USAGE_TOTAL_SQL,
  MOVEMENT_HISTORY_SQL,
} from '../services/inventory.queries';
import { DEFAULT_USAGE_LIMIT, materialUsageFromRows } from '../services/inventory.service';

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
  /** Grupo "Sin conteo inicial" de "Qué comprar": no se puede calcular cuánto comprar. */
  withoutInitialCount: MaterialStockItem[];
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
  const uncountedQuery = useMemo(() => buildStockQuery({ onlyWithoutInitialCount: true }), []);

  const list = useQuery<Record<string, unknown>>(listQuery.sql, listQuery.parameters);
  const low = useQuery<Record<string, unknown>>(lowQuery.sql, lowQuery.parameters);
  const uncounted = useQuery<Record<string, unknown>>(
    uncountedQuery.sql,
    uncountedQuery.parameters,
  );

  const items = useMemo(() => list.data.map(materialStockItemFromRow), [list.data]);
  const suggestions = useMemo(
    () => buildPurchaseSuggestions(low.data.map(materialStockItemFromRow)),
    [low.data],
  );
  const withoutInitialCount = useMemo(
    () => uncounted.data.map(materialStockItemFromRow).filter(isRelevantWithoutCount),
    [uncounted.data],
  );

  const refreshList = list.refresh;
  const refreshLow = low.refresh;
  const refreshUncounted = uncounted.refresh;
  const refresh = useCallback(() => {
    void Promise.all([refreshList?.(), refreshLow?.(), refreshUncounted?.()]).catch(
      () => undefined,
    );
  }, [refreshList, refreshLow, refreshUncounted]);

  return {
    items,
    suggestions,
    withoutInitialCount,
    hasPending: items.some((item) => item.hasPending),
    isLoading: list.isLoading || low.isLoading || uncounted.isLoading,
    hasError: Boolean(list.error ?? low.error ?? uncounted.error),
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

export interface MaterialUsageResult {
  usage: MaterialUsageByVisit;
  isLoading: boolean;
  hasError: boolean;
}

/** "Uso por visita" de un material, reactivo (misma lógica que `getMaterialUsageByVisit`). */
export function useMaterialUsageByVisit(
  materialId: string,
  limit: number = DEFAULT_USAGE_LIMIT,
): MaterialUsageResult {
  const list = useQuery<Record<string, unknown>>(MATERIAL_USAGE_BY_VISIT_SQL, [materialId, limit]);
  const totals = useQuery<Record<string, unknown>>(MATERIAL_USAGE_TOTAL_SQL, [materialId]);
  const usage = useMemo(
    () => materialUsageFromRows(materialId, list.data, totals.data[0]),
    [materialId, list.data, totals.data],
  );
  return {
    usage,
    isLoading: list.isLoading || totals.isLoading,
    hasError: Boolean(list.error ?? totals.error),
  };
}
