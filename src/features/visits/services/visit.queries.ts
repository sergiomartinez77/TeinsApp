import {
  FINISHED_STATUSES,
  UNSYNCED_STATUSES,
  VISIT_TYPE_LABELS,
  VISIT_TYPES,
} from '@/models/visit.model';
import { containsAnyCondition, escapeLike, type SqlQuery } from '@/utils/sql.utils';

// Se reexportan para no romper a quien ya las importaba desde aquí.
export { escapeLike, type SqlQuery };

/**
 * Consultas SQL de lectura de visitas.
 * Todas filtran por técnico: cada técnico solo ve sus propias visitas.
 */

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

const FINISHED = inList(FINISHED_STATUSES);
const UNSYNCED = inList(UNSYNCED_STATUSES);

// ── Dashboard ────────────────────────────────────────────────────────────────

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

// ── Listado ──────────────────────────────────────────────────────────────────

/** Pestañas del listado de visitas. */
export type VisitFilter = 'all' | 'inProgress' | 'assigned' | 'completed';

export const VISIT_FILTERS: readonly { key: VisitFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'inProgress', label: 'En progreso' },
  { key: 'assigned', label: 'Asignadas' },
  { key: 'completed', label: 'Completadas' },
];

const FILTER_CONDITIONS: Readonly<Record<VisitFilter, string | null>> = {
  all: null,
  inProgress: "status = 'inProgress'",
  assigned: "status = 'assigned'",
  completed: `status IN (${FINISHED})`,
};

/**
 * Tipos de visita cuyo nombre visible contiene el texto buscado.
 * Permite encontrar "Inspección de Energía" aunque en la base el tipo sea `energia`.
 */
export function visitTypesMatching(search: string): string[] {
  const needle = search.toLocaleLowerCase('es');
  return VISIT_TYPES.filter((type) =>
    VISIT_TYPE_LABELS[type].toLocaleLowerCase('es').includes(needle),
  );
}

export interface VisitListOptions {
  filter: VisitFilter;
  search: string;
  /** Máximo de filas a devolver. */
  limit: number;
}

/**
 * Consulta del listado: por técnico, con pestaña, búsqueda de texto libre
 * (título, cliente, dirección y tipo) y límite para paginar.
 */
export function buildVisitListQuery(technicianId: string, options: VisitListOptions): SqlQuery {
  const conditions = ['technician_id = ?'];
  const parameters: (string | number)[] = [technicianId];

  const filterCondition = FILTER_CONDITIONS[options.filter];
  if (filterCondition) conditions.push(filterCondition);

  const search = options.search.trim();
  if (search) {
    // Ignora mayúsculas también en letras acentuadas ("ÉXITO" encuentra "éxito").
    const text = containsAnyCondition(['title', 'client_name', 'address', 'visit_type'], search);
    const textMatches = [text.sql];
    parameters.push(...text.parameters);

    const types = visitTypesMatching(search);
    if (types.length > 0) {
      textMatches.push(`visit_type IN (${types.map(() => '?').join(', ')})`);
      parameters.push(...types);
    }
    conditions.push(`(${textMatches.join(' OR ')})`);
  }

  parameters.push(options.limit);
  return {
    sql: `SELECT * FROM visits WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    parameters,
  };
}

/** Una visita por id. Incluye el técnico para no exponer visitas ajenas. */
export const VISIT_BY_ID_SQL = 'SELECT * FROM visits WHERE id = ? AND technician_id = ? LIMIT 1';
