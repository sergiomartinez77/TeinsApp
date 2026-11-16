/**
 * Consultas SQL de anotaciones.
 */

/** Anotación de la visita: hay como máximo una por visita. */
export const ANNOTATION_BY_VISIT_SQL =
  'SELECT * FROM annotations WHERE visit_id = ? ORDER BY created_at ASC LIMIT 1';

/** Visita del técnico: para no escribir en visitas ajenas o cerradas. */
export const OWN_VISIT_SQL =
  'SELECT id, status FROM visits WHERE id = ? AND technician_id = ? LIMIT 1';

export const INSERT_ANNOTATION_SQL = `INSERT INTO annotations (
  id, visit_id, title, elements, base_image_path, canvas_width, canvas_height,
  sync_status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const UPDATE_ANNOTATION_SQL = `UPDATE annotations
SET elements = ?, canvas_width = ?, canvas_height = ?, sync_status = ?, updated_at = ?
WHERE id = ?`;
