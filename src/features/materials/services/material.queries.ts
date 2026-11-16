import { containsAnyCondition, type SqlQuery } from '@/utils/sql.utils';

/**
 * Consultas SQL de materiales.
 * El catálogo es de solo lectura: aquí nunca se escribe en `material_catalog`.
 */

export interface CatalogQueryOptions {
  /** Texto libre: se busca en el código y en el nombre. */
  search: string;
  /** Máximo de filas a devolver. */
  limit: number;
}

/** Catálogo activo, ordenado por nombre, con búsqueda y límite para paginar. */
export function buildCatalogQuery(options: CatalogQueryOptions): SqlQuery {
  const conditions = ['is_active = 1'];
  const parameters: (string | number)[] = [];

  const search = options.search.trim();
  if (search) {
    // Ignora mayúsculas también en letras acentuadas ("CAÑERÍA" encuentra "cañería").
    const text = containsAnyCondition(['code', 'name'], search);
    conditions.push(`(${text.sql})`);
    parameters.push(...text.parameters);
  }

  parameters.push(options.limit);
  return {
    sql: `SELECT * FROM material_catalog WHERE ${conditions.join(' AND ')} ORDER BY name COLLATE NOCASE ASC, code ASC LIMIT ?`,
    parameters,
  };
}

/** Materiales de una visita, en el orden en que se agregaron. */
export const VISIT_MATERIALS_SQL =
  'SELECT * FROM visit_materials WHERE visit_id = ? ORDER BY created_at ASC';

/** Visita del técnico: para no escribir en visitas ajenas o cerradas. */
export const OWN_VISIT_SQL =
  'SELECT id, status FROM visits WHERE id = ? AND technician_id = ? LIMIT 1';

/** Un material del catálogo por id. */
export const CATALOG_MATERIAL_BY_ID_SQL = 'SELECT * FROM material_catalog WHERE id = ? LIMIT 1';

/** Si el material ya está en la visita. */
export const VISIT_MATERIAL_BY_MATERIAL_SQL =
  'SELECT id FROM visit_materials WHERE visit_id = ? AND material_id = ? LIMIT 1';

/** Un material de la visita por id. */
export const VISIT_MATERIAL_BY_ID_SQL =
  'SELECT * FROM visit_materials WHERE id = ? AND visit_id = ? LIMIT 1';
