import { FINISHED_STATUSES } from '@/models/visit.model';

/**
 * Consultas propias del asistente básico (base local de PowerSync). Lo demás
 * reutiliza las APIs de inventario y de informes.
 *
 * Como el resto de la app, las visitas se filtran por técnico: en el teléfono
 * solo están las visitas del usuario (ver docs/BACKEND.md).
 */

/** Catálogo activo, para encontrar materiales aunque estén mal escritos. */
export const ACTIVE_CATALOG_SQL =
  'SELECT id, code, name, unit FROM material_catalog WHERE is_active = 1 ORDER BY name COLLATE NOCASE ASC, code ASC';

const FINISHED = FINISHED_STATUSES.map((status) => `'${status}'`).join(', ');

/** Visitas por hacer (asignadas o en progreso): primero las en progreso. Parámetros: técnico, límite. */
export const PENDING_VISITS_SQL = `
SELECT * FROM visits
WHERE technician_id = ? AND status IN ('assigned', 'inProgress')
ORDER BY CASE WHEN status = 'inProgress' THEN 0 ELSE 1 END, created_at DESC
LIMIT ?`;

/** Conteo de las visitas por hacer. Parámetro: técnico. */
export const PENDING_VISITS_COUNT_SQL = `
SELECT
  COALESCE(SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned,
  COALESCE(SUM(CASE WHEN status = 'inProgress' THEN 1 ELSE 0 END), 0) AS in_progress,
  COALESCE(SUM(CASE WHEN status IN (${FINISHED}) THEN 1 ELSE 0 END), 0) AS completed
FROM visits WHERE technician_id = ?`;

/**
 * Visitas con actividad en el rango: creadas, iniciadas o finalizadas.
 * Parámetros: técnico, desde, hasta (los tres pares), límite.
 */
export const VISITS_ACTIVE_IN_RANGE_SQL = `
SELECT * FROM visits
WHERE technician_id = ?
  AND ((julianday(created_at) BETWEEN julianday(?) AND julianday(?))
    OR (started_at IS NOT NULL AND julianday(started_at) BETWEEN julianday(?) AND julianday(?))
    OR (completed_at IS NOT NULL AND julianday(completed_at) BETWEEN julianday(?) AND julianday(?)))
ORDER BY COALESCE(completed_at, started_at, created_at) DESC
LIMIT ?`;

/** Una visita del técnico por id (para el PDF elegido en la lista). */
export { VISIT_BY_ID_SQL } from '@/features/visits/services/visit.queries';
