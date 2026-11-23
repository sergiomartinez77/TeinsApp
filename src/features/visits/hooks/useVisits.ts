import { useQuery } from '@powersync/react';
import { useCallback, useMemo, useState } from 'react';

import { PAGE_SIZE } from '@/constants/app.constants';
import { visitFromRow, type Visit } from '@/models/visit.model';

import {
  buildVisitByIdQuery,
  buildVisitListQuery,
  type VisitFilter,
} from '../services/visit.queries';

export interface VisitListResult {
  visits: Visit[];
  isLoading: boolean;
  hasError: boolean;
  /** Hay más visitas de las mostradas. */
  hasMore: boolean;
  loadMore: () => void;
  isRefreshing: boolean;
  refresh: () => void;
}

/**
 * Listado reactivo de visitas, con pestaña, búsqueda y paginación. `scope`:
 * id del técnico (sus visitas) o `null` (todas: admin y oficina, ver
 * `visitScopeFor`).
 *
 * La paginación amplía el límite de la consulta de página en página (20):
 * así la lista sigue siendo reactiva y se actualiza sola al cambiar los datos.
 */
export function useVisits(
  scope: string | null,
  filter: VisitFilter,
  search: string,
): VisitListResult {
  const pageKey = `${scope ?? '*'}|${filter}|${search}`;
  const [paging, setPaging] = useState({ key: pageKey, pages: 1 });
  // Al cambiar de pestaña o de búsqueda se vuelve a la primera página.
  const pages = paging.key === pageKey ? paging.pages : 1;
  const pageLimit = pages * PAGE_SIZE.visits;

  // Se pide una fila de más para saber si quedan visitas por cargar.
  const query = useMemo(
    () => buildVisitListQuery(scope, { filter, search, limit: pageLimit + 1 }),
    [scope, filter, search, pageLimit],
  );
  const result = useQuery<Record<string, unknown>>(query.sql, query.parameters);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasMore = result.data.length > pageLimit;
  const visits = useMemo(
    () => result.data.slice(0, pageLimit).map(visitFromRow),
    [result.data, pageLimit],
  );

  const loadMore = useCallback(() => {
    if (hasMore) setPaging({ key: pageKey, pages: pages + 1 });
  }, [hasMore, pageKey, pages]);

  const refreshQuery = result.refresh;
  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.resolve(refreshQuery?.())
      .catch(() => undefined)
      .finally(() => setIsRefreshing(false));
  }, [refreshQuery]);

  return {
    visits,
    isLoading: result.isLoading,
    hasError: Boolean(result.error),
    hasMore,
    loadMore,
    isRefreshing,
    refresh,
  };
}

export interface VisitResult {
  visit: Visit | null;
  isLoading: boolean;
  hasError: boolean;
}

/**
 * Una visita, reactiva: se actualiza al cambiar de estado. `scope`: id del
 * técnico (solo si es suya) o `null` (cualquiera del teléfono: admin y oficina).
 */
export function useVisit(scope: string | null, visitId: string): VisitResult {
  const query = useMemo(() => buildVisitByIdQuery(visitId, scope), [visitId, scope]);
  const result = useQuery<Record<string, unknown>>(query.sql, query.parameters);
  const row = result.data[0];
  const visit = useMemo(() => (row ? visitFromRow(row) : null), [row]);

  return { visit, isLoading: result.isLoading, hasError: Boolean(result.error) };
}
