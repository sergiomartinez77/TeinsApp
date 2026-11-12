import { useQuery } from '@powersync/react';
import { useCallback, useMemo, useState } from 'react';

import { PAGE_SIZE } from '@/constants/app.constants';
import { visitFromRow, type Visit } from '@/models/visit.model';

import { buildVisitListQuery, VISIT_BY_ID_SQL, type VisitFilter } from '../services/visit.queries';

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
 * Listado reactivo de visitas del técnico, con pestaña, búsqueda y paginación.
 *
 * La paginación amplía el límite de la consulta de página en página (20):
 * así la lista sigue siendo reactiva y se actualiza sola al cambiar los datos.
 */
export function useVisits(
  technicianId: string,
  filter: VisitFilter,
  search: string,
): VisitListResult {
  const scope = `${filter}|${search}`;
  const [paging, setPaging] = useState({ scope, pages: 1 });
  // Al cambiar de pestaña o de búsqueda se vuelve a la primera página.
  const pages = paging.scope === scope ? paging.pages : 1;
  const pageLimit = pages * PAGE_SIZE.visits;

  // Se pide una fila de más para saber si quedan visitas por cargar.
  const query = useMemo(
    () => buildVisitListQuery(technicianId, { filter, search, limit: pageLimit + 1 }),
    [technicianId, filter, search, pageLimit],
  );
  const result = useQuery<Record<string, unknown>>(query.sql, query.parameters);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasMore = result.data.length > pageLimit;
  const visits = useMemo(
    () => result.data.slice(0, pageLimit).map(visitFromRow),
    [result.data, pageLimit],
  );

  const loadMore = useCallback(() => {
    if (hasMore) setPaging({ scope, pages: pages + 1 });
  }, [hasMore, scope, pages]);

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

/** Una visita del técnico, reactiva: se actualiza al cambiar de estado. */
export function useVisit(technicianId: string, visitId: string): VisitResult {
  const result = useQuery<Record<string, unknown>>(VISIT_BY_ID_SQL, [visitId, technicianId]);
  const row = result.data[0];
  const visit = useMemo(() => (row ? visitFromRow(row) : null), [row]);

  return { visit, isLoading: result.isLoading, hasError: Boolean(result.error) };
}
