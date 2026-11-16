import { useQuery } from '@powersync/react';

/** Cambios rechazados por el servidor que quedaron guardados para revisión. */
export const SYNC_ISSUE_COUNT_SQL = 'SELECT COUNT(*) AS count FROM sync_issues';

/** Número de cambios rechazados, reactivo: se actualiza solo al registrarse uno nuevo. */
export function useSyncIssueCount(): number {
  const result = useQuery<{ count: unknown }>(SYNC_ISSUE_COUNT_SQL);
  const count = Number(result.data[0]?.count ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}
