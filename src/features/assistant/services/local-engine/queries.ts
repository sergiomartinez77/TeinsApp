import { FINISHED_STATUSES } from '@/models/visit.model';
import type { SqlQuery } from '@/utils/sql.utils';

/**
 * Consultas propias del asistente básico (base local de PowerSync). Lo demás
 * reutiliza las APIs de inventario, visitas e informes.
 *
 * Alcance de las visitas (`scope`): el id del técnico (solo las suyas) o
 * `null` (todas las del teléfono: administración y oficina reciben todas las
 * visitas, ver `visitScopeFor` y docs/BACKEND.md).
 */

/** Catálogo activo, para encontrar materiales aunque estén mal escritos. */
export const ACTIVE_CATALOG_SQL =
  'SELECT id, code, name, unit FROM material_catalog WHERE is_active = 1 ORDER BY name COLLATE NOCASE ASC, code ASC';

const FINISHED = FINISHED_STATUSES.map((status) => `'${status}'`).join(', ');

/** Nombre del técnico de cada visita (perfil local), como en el listado de visitas. */
const TECHNICIAN_NAME = `(SELECT coalesce(nullif(trim(p.full_name), ''), p.email)
    FROM profiles p WHERE p.id = visits.technician_id) AS technician_name`;

const scoped = (scope: string | null, condition: string | null) => {
  const conditions = [scope === null ? null : 'technician_id = ?', condition].filter(Boolean);
  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    parameters: scope === null ? [] : [scope],
  };
};

/** Visitas por hacer (asignadas o en progreso): primero las en progreso. */
export function buildPendingVisitsQuery(scope: string | null, limit: number): SqlQuery {
  const { where, parameters } = scoped(scope, "status IN ('assigned', 'inProgress')");
  return {
    sql: `
SELECT visits.*, ${TECHNICIAN_NAME} FROM visits
${where}
ORDER BY CASE WHEN status = 'inProgress' THEN 0 ELSE 1 END, created_at DESC
LIMIT ?`,
    parameters: [...parameters, limit],
  };
}

/** Conteo de las visitas por hacer y completadas. */
export function buildPendingVisitsCountQuery(scope: string | null): SqlQuery {
  const { where, parameters } = scoped(scope, null);
  return {
    sql: `
SELECT
  COALESCE(SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned,
  COALESCE(SUM(CASE WHEN status = 'inProgress' THEN 1 ELSE 0 END), 0) AS in_progress,
  COALESCE(SUM(CASE WHEN status IN (${FINISHED}) THEN 1 ELSE 0 END), 0) AS completed
FROM visits ${where}`,
    parameters,
  };
}

/** Visitas con actividad en el rango [desde, hasta]: creadas, iniciadas o finalizadas. */
export function buildVisitsActiveInRangeQuery(
  scope: string | null,
  from: string,
  to: string,
  limit: number,
): SqlQuery {
  const { where, parameters } = scoped(
    scope,
    `((julianday(created_at) BETWEEN julianday(?) AND julianday(?))
    OR (started_at IS NOT NULL AND julianday(started_at) BETWEEN julianday(?) AND julianday(?))
    OR (completed_at IS NOT NULL AND julianday(completed_at) BETWEEN julianday(?) AND julianday(?)))`,
  );
  return {
    sql: `
SELECT visits.*, ${TECHNICIAN_NAME} FROM visits
${where}
ORDER BY COALESCE(completed_at, started_at, created_at) DESC
LIMIT ?`,
    parameters: [...parameters, from, to, from, to, from, to, limit],
  };
}
