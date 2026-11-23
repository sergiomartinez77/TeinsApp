import { useQuery } from '@powersync/react';
import { useCallback, useMemo, useState } from 'react';

import {
  buildInProgressQuery,
  buildVisitStatsQuery,
  visitStatsFromRow,
  type VisitStats,
  type VisitStatsRow,
} from '@/features/visits/services/visit.queries';
import { visitFromRow, type Visit } from '@/models/visit.model';

/** Máximo de visitas en progreso que muestra el dashboard. */
export const DASHBOARD_IN_PROGRESS_LIMIT = 3;

export interface DashboardData {
  stats: VisitStats;
  inProgress: Visit[];
  /** Primera carga desde la base local. */
  isLoading: boolean;
  /** Hubo un problema al leer los datos locales. */
  hasError: boolean;
  isRefreshing: boolean;
  refresh: () => void;
}

/**
 * Datos del dashboard. Son consultas reactivas sobre SQLite: la pantalla se
 * actualiza sola cuando cambian las visitas, sin sondeos. `scope`: id del
 * técnico (sus visitas) o `null` (todas las del teléfono: admin y oficina).
 */
export function useDashboard(scope: string | null): DashboardData {
  const stats = useMemo(() => buildVisitStatsQuery(scope), [scope]);
  const inProgress = useMemo(
    () => buildInProgressQuery(scope, DASHBOARD_IN_PROGRESS_LIMIT),
    [scope],
  );
  const statsQuery = useQuery<VisitStatsRow>(stats.sql, stats.parameters);
  const inProgressQuery = useQuery<Record<string, unknown>>(inProgress.sql, inProgress.parameters);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const statsValue = useMemo(() => visitStatsFromRow(statsQuery.data[0]), [statsQuery.data]);
  const inProgressVisits = useMemo(
    () => inProgressQuery.data.map(visitFromRow),
    [inProgressQuery.data],
  );

  const refreshStats = statsQuery.refresh;
  const refreshInProgress = inProgressQuery.refresh;
  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all([refreshStats?.(), refreshInProgress?.()])
      .catch(() => undefined)
      .finally(() => setIsRefreshing(false));
  }, [refreshStats, refreshInProgress]);

  return {
    stats: statsValue,
    inProgress: inProgressVisits,
    isLoading: statsQuery.isLoading || inProgressQuery.isLoading,
    hasError: Boolean(statsQuery.error ?? inProgressQuery.error),
    isRefreshing,
    refresh,
  };
}
