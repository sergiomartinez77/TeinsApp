/**
 * Consultas SQL de planos (tabla `annotations`) y figuras (`annotation_figures`).
 */

/** Planos de la visita, del más antiguo al más nuevo (el orden da "Plano 1", "Plano 2"...). */
export const ANNOTATIONS_BY_VISIT_SQL =
  'SELECT * FROM annotations WHERE visit_id = ? ORDER BY created_at ASC, id ASC';

/** Un plano por id. */
export const ANNOTATION_BY_ID_SQL = 'SELECT * FROM annotations WHERE id = ? LIMIT 1';

/** Plano de una visita concreta (para no escribir en planos de otra visita). */
export const ANNOTATION_IN_VISIT_SQL =
  'SELECT id FROM annotations WHERE id = ? AND visit_id = ? LIMIT 1';

/** Visita del técnico: para no escribir en visitas ajenas o cerradas. */
export const OWN_VISIT_SQL =
  'SELECT id, status FROM visits WHERE id = ? AND technician_id = ? LIMIT 1';

export const INSERT_ANNOTATION_SQL = `INSERT INTO annotations (
  id, visit_id, title, elements, base_image_path, canvas_width, canvas_height,
  format_version, sync_status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Guarda los elementos: siempre en el formato 2 (centímetros). */
export const UPDATE_ANNOTATION_ELEMENTS_SQL = `UPDATE annotations
SET elements = ?, format_version = ?, sync_status = ?, updated_at = ?
WHERE id = ?`;

export const RENAME_ANNOTATION_SQL = `UPDATE annotations
SET title = ?, sync_status = ?, updated_at = ?
WHERE id = ?`;

export const DELETE_ANNOTATION_SQL = 'DELETE FROM annotations WHERE id = ?';

// ── Figuras ──────────────────────────────────────────────────────────────────

/** Figuras del técnico, de la más reciente a la más antigua. */
export const FIGURES_BY_TECHNICIAN_SQL =
  'SELECT * FROM annotation_figures WHERE technician_id = ? ORDER BY created_at DESC, id ASC';

export const INSERT_FIGURE_SQL = `INSERT INTO annotation_figures (
  id, technician_id, name, elements, width, height, sync_status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const DELETE_FIGURE_SQL =
  'DELETE FROM annotation_figures WHERE id = ? AND technician_id = ?';
