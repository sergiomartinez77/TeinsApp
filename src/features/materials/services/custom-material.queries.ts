/**
 * Consultas de los materiales de la visita que también usan los personalizados.
 * (Las del catálogo siguen en `material.queries.ts`.)
 */

/**
 * Alta de un material en la visita (del catálogo o personalizado).
 * `is_custom` va al final: 0 = del catálogo, 1 = personalizado.
 */
export const INSERT_VISIT_MATERIAL_SQL = `INSERT INTO visit_materials (
  id, visit_id, material_id, material_code, material_name, unit,
  quantity, observations, sync_status, created_at, updated_at, is_custom
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Personalizados de la visita (para no repetir nombre y unidad). */
export const VISIT_CUSTOM_MATERIALS_SQL =
  'SELECT id, material_name, unit FROM visit_materials WHERE visit_id = ? AND is_custom = 1';
