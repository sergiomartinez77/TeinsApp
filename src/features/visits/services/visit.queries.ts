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
 *
 * Alcance (`scope`): el id del técnico filtra sus visitas; `null` = todas las
 * del teléfono (administración y oficina, ver `visitScopeFor`). Las
 * constantes `*_SQL` con `technician_id = ?` son las del técnico; las
 * escrituras siempre comprueban que la visita sea propia (VISIT_BY_ID_SQL).
 */

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

const FINISHED = inList(FINISHED_STATUSES);
const UNSYNCED = inList(UNSYNCED_STATUSES);

/**
 * Nombre del técnico de la visita (perfil local; admin y oficina reciben los
 * perfiles). Subconsulta, no JOIN: las demás columnas siguen sin prefijo.
 */
const TECHNICIAN_NAME_SQL = `(SELECT coalesce(nullif(trim(p.full_name), ''), p.email)
    FROM profiles p WHERE p.id = visits.technician_id) AS technician_name`;

/** `SELECT` de visitas con el nombre del técnico. */
const VISIT_SELECT = `SELECT visits.*, ${TECHNICIAN_NAME_SQL} FROM visits`;

const scopeCondition = (scope: string | null) => (scope === null ? null : 'technician_id = ?');
const scopeParameters = (scope: string | null): string[] => (scope === null ? [] : [scope]);

// ── Dashboard ────────────────────────────────────────────────────────────────

/** Conteos para el dashboard, en una sola pasada por la tabla. */
const VISIT_STATS_SELECT = `
  SELECT
    COALESCE(SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned,
    COALESCE(SUM(CASE WHEN status = 'inProgress' THEN 1 ELSE 0 END), 0) AS in_progress,
    COALESCE(SUM(CASE WHEN status IN (${FINISHED}) THEN 1 ELSE 0 END), 0) AS completed,
    COALESCE(SUM(CASE WHEN sync_status IN (${UNSYNCED}) THEN 1 ELSE 0 END), 0) AS pending_sync
  FROM visits`;

/** Conteos para el dashboard del técnico. Parámetro: técnico. */
export const VISIT_STATS_SQL = `${VISIT_STATS_SELECT}
  WHERE technician_id = ?`;

/** Visitas en progreso, la iniciada más recientemente primero. */
export const IN_PROGRESS_VISITS_SQL = `
  SELECT * FROM visits
  WHERE technician_id = ? AND status = 'inProgress'
  ORDER BY COALESCE(started_at, created_at) DESC
  LIMIT ?`;

/** Conteos del dashboard según el alcance (técnico o todas las visitas). */
export function buildVisitStatsQuery(scope: string | null): SqlQuery {
  if (scope !== null) return { sql: VISIT_STATS_SQL, parameters: [scope] };
  return { sql: VISIT_STATS_SELECT, parameters: [] };
}

/** Visitas en progreso según el alcance, con el nombre del técnico. */
export function buildInProgressQuery(scope: string | null, limit: number): SqlQuery {
  const conditions = [scopeCondition(scope), "status = 'inProgress'"].filter(Boolean);
  return {
    sql: `${VISIT_SELECT}
  WHERE ${conditions.join(' AND ')}
  ORDER BY COALESCE(started_at, created_at) DESC
  LIMIT ?`,
    parameters: [...scopeParameters(scope), limit],
  };
}

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
 * Consulta del listado: por alcance (técnico o, con `null`, todas), con
 * pestaña, búsqueda de texto libre (título, cliente, dirección y tipo) y
 * límite para paginar. Trae también el nombre del técnico.
 */
export function buildVisitListQuery(scope: string | null, options: VisitListOptions): SqlQuery {
  const conditions: string[] = [];
  const parameters: (string | number)[] = [...scopeParameters(scope)];
  const own = scopeCondition(scope);
  if (own) conditions.push(own);

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
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return {
    sql: `${VISIT_SELECT}${where} ORDER BY created_at DESC LIMIT ?`,
    parameters,
  };
}

/**
 * Una visita por id. Incluye el técnico para no exponer visitas ajenas.
 * Es la que usan las ESCRITURAS: solo se modifica una visita propia.
 */
export const VISIT_BY_ID_SQL = 'SELECT * FROM visits WHERE id = ? AND technician_id = ? LIMIT 1';

/** Lectura de una visita por id según el alcance (admin/oficina: cualquiera del teléfono). */
export function buildVisitByIdQuery(visitId: string, scope: string | null): SqlQuery {
  const own = scopeCondition(scope);
  return {
    sql: `${VISIT_SELECT} WHERE id = ?${own ? ` AND ${own}` : ''} LIMIT 1`,
    parameters: [visitId, ...scopeParameters(scope)],
  };
}
