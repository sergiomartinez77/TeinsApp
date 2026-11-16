/**
 * Consultas SQL de fotografías.
 */

/** Fotos de la visita, de la más reciente a la más antigua, con límite para paginar. */
export const VISIT_PHOTOS_SQL =
  'SELECT * FROM photos WHERE visit_id = ? ORDER BY captured_at DESC, id DESC LIMIT ?';

/** Total de fotos de la visita (para el subtítulo y el contador del visor). */
export const VISIT_PHOTO_COUNT_SQL = 'SELECT COUNT(*) AS count FROM photos WHERE visit_id = ?';

/** Visita del técnico: para no escribir en visitas ajenas o cerradas. */
export const OWN_VISIT_SQL =
  'SELECT id, status FROM visits WHERE id = ? AND technician_id = ? LIMIT 1';

/** Una foto de la visita por id. */
export const PHOTO_BY_ID_SQL = 'SELECT * FROM photos WHERE id = ? AND visit_id = ? LIMIT 1';

export const INSERT_PHOTO_SQL = `INSERT INTO photos (
  id, visit_id, form_field_id, local_path, storage_path, storage_url, caption,
  sync_status, captured_at, uploaded_at, file_size_bytes, width, height
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export const DELETE_PHOTO_SQL = 'DELETE FROM photos WHERE id = ?';

// ── Subida ───────────────────────────────────────────────────────────────────

const PENDING_WHERE = `p.sync_status IN ('local', 'pendingUpload', 'uploadError')
  AND p.visit_id IN (SELECT id FROM visits WHERE technician_id = ?)`;

/** Fotos del técnico pendientes de subir, de la más antigua a la más reciente. */
export const PENDING_UPLOADS_SQL = `SELECT p.id, p.visit_id, p.local_path FROM photos p
WHERE ${PENDING_WHERE}
ORDER BY p.captured_at ASC, p.id ASC`;

export const PENDING_UPLOAD_COUNT_SQL = `SELECT COUNT(*) AS count FROM photos p WHERE ${PENDING_WHERE}`;

/** Fotos que quedaron "subiendo" porque la app se cerró a mitad: vuelven a la cola. */
export const RESET_INTERRUPTED_UPLOADS_SQL = `UPDATE photos SET sync_status = 'pendingUpload'
WHERE sync_status = 'uploading'
  AND visit_id IN (SELECT id FROM visits WHERE technician_id = ?)`;

export const MARK_PHOTO_STATUS_SQL = 'UPDATE photos SET sync_status = ? WHERE id = ?';

/** `storage_path` y `storage_url` se escriben juntos (restricción del servidor). */
export const MARK_PHOTO_UPLOADED_SQL = `UPDATE photos
SET sync_status = 'uploaded', storage_path = ?, storage_url = ?, uploaded_at = ?
WHERE id = ?`;
