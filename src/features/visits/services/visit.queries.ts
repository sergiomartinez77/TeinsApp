import { FINISHED_STATUSES, UNSYNCED_STATUSES } from '@/models/visit.model';

/**
 * Consultas SQL de lectura de visitas.
 * Todas filtran por técnico: cada técnico solo ve sus propias visitas.
 */

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

const FINISHED = inList(FINISHED_STATUSES);
const UNSYNCED = inList(UNSYNCED_STATUSES);

/** Conteos para el dashboard, en una sola pasada por la tabla. */
export const VISIT_STATS_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned,
    COALESCE(SUM(CASE WHEN status = 'inProgress' THEN 1 ELSE 0 END), 0) AS in_progress,
    COALESCE(SUM(CASE WHEN status IN (${FINISHED}) THEN 1 ELSE 0 END), 0) AS completed,
    COALESCE(SUM(CASE WHEN sync_status IN (${UNSYNCED}) THEN 1 ELSE 0 END), 0) AS pending_sync
  FROM visits
  WHERE technician_id = ?`;

/** Visitas en progreso, la iniciada más recientemente primero. */
export const IN_PROGRESS_VISITS_SQL = `
  SELECT * FROM visits
  WHERE technician_id = ? AND status = 'inProgress'
  ORDER BY COALESCE(started_at, created_at) DESC
  LIMIT ?`;

export interface VisitStatsRow {
  assigned: number;
  in_progress: number;
  completed: number;
  pending_sync: number;
}

export interface VisitStats {
  assigned: number;
  inProgress: number;
  completed: number;
  pendingSync: number;
}

export const EMPTY_VISIT_STATS: VisitStats = {
  assigned: 0,
  inProgress: 0,
  completed: 0,
  pendingSync: 0,
};

export function visitStatsFromRow(row: Partial<VisitStatsRow> | undefined): VisitStats {
  if (!row) return EMPTY_VISIT_STATS;
  return {
    assigned: Number(row.assigned ?? 0),
    inProgress: Number(row.in_progress ?? 0),
    completed: Number(row.completed ?? 0),
    pendingSync: Number(row.pending_sync ?? 0),
  };
}
