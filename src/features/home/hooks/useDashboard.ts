import { useQuery } from '@powersync/react';
import { useCallback, useMemo, useState } from 'react';

import {
  IN_PROGRESS_VISITS_SQL,
  VISIT_STATS_SQL,
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
 * actualiza sola cuando cambian las visitas, sin sondeos.
 */
export function useDashboard(technicianId: string): DashboardData {
  const statsQuery = useQuery<VisitStatsRow>(VISIT_STATS_SQL, [technicianId]);
  const inProgressQuery = useQuery<Record<string, unknown>>(IN_PROGRESS_VISITS_SQL, [
    technicianId,
    DASHBOARD_IN_PROGRESS_LIMIT,
  ]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const stats = useMemo(() => visitStatsFromRow(statsQuery.data[0]), [statsQuery.data]);
  const inProgress = useMemo(() => inProgressQuery.data.map(visitFromRow), [inProgressQuery.data]);

  const refreshStats = statsQuery.refresh;
  const refreshInProgress = inProgressQuery.refresh;
  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all([refreshStats?.(), refreshInProgress?.()])
      .catch(() => undefined)
      .finally(() => setIsRefreshing(false));
  }, [refreshStats, refreshInProgress]);

  return {
    stats,
    inProgress,
    isLoading: statsQuery.isLoading || inProgressQuery.isLoading,
    hasError: Boolean(statsQuery.error ?? inProgressQuery.error),
    isRefreshing,
    refresh,
  };
}
