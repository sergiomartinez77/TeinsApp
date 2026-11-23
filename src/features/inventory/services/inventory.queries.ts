import { containsAnyCondition, type SqlQuery } from '@/utils/sql.utils';

/**
 * Consultas SQL del inventario (base local de PowerSync).
 *
 * `material_stock` la calcula el servidor; aquí solo se lee. Las filas con
 * `sync_status` pendiente ('local', 'pendingSync', 'syncing') son cambios de
 * este dispositivo que aún no se subieron: las existencias mostradas todavía
 * no los incluyen.
 */

/** Estados locales "aún sin subir", como lista SQL. */
const PENDING_STATES_SQL = "('local', 'pendingSync', 'syncing')";

/**
 * Sin conteo inicial: el servidor tiene existencias pero nunca hubo compras ni
 * ajustes (ver `needsInitialCount` en el modelo). Su "en bodega" es solo el
 * uso en visitas en negativo: no se trata como existencia real.
 */
const NEEDS_INITIAL_COUNT_SQL =
  's.material_id IS NOT NULL AND coalesce(s.purchased, 0) = 0 AND coalesce(s.adjusted, 0) = 0';

/** Bajo mínimo: existencias conocidas, con conteo inicial, y menores que el mínimo. */
const IS_LOW_SQL = `s.material_id IS NOT NULL AND c.min_stock IS NOT NULL AND s.on_hand < c.min_stock AND NOT (${NEEDS_INITIAL_COUNT_SQL})`;

const STOCK_SELECT = `
SELECT c.id AS material_id, c.code, c.name, c.unit, c.category, c.min_stock,
       s.material_id AS stock_id, s.purchased, s.adjusted, s.used, s.on_hand,
       (SELECT count(*) FROM material_stock_movements m
         WHERE m.material_id = c.id AND m.sync_status IN ${PENDING_STATES_SQL}) AS pending_movements,
       (SELECT count(*) FROM visit_materials vm
         WHERE vm.material_id = c.id AND coalesce(vm.is_custom, 0) = 0
           AND vm.sync_status IN ${PENDING_STATES_SQL}) AS pending_uses
FROM material_catalog c
LEFT JOIN material_stock s ON s.material_id = c.id`;

export interface StockQueryOptions {
  /** Texto libre: se busca en el código y en el nombre. */
  search?: string;
  /** Solo los materiales bajo mínimo. */
  onlyLow?: boolean;
  /** Solo los materiales sin conteo inicial (nunca tuvieron compras ni ajustes). */
  onlyWithoutInitialCount?: boolean;
  /** Un solo material. */
  materialId?: string;
  /** Máximo de filas. */
  limit?: number;
}

/**
 * Existencias de los materiales activos del catálogo: primero los que están
 * bajo mínimo y luego por nombre.
 */
export function buildStockQuery(options: StockQueryOptions = {}): SqlQuery {
  const conditions = ['c.is_active = 1'];
  const parameters: (string | number)[] = [];

  const search = options.search?.trim() ?? '';
  if (search) {
    const text = containsAnyCondition(['c.code', 'c.name'], search);
    conditions.push(`(${text.sql})`);
    parameters.push(...text.parameters);
  }
  if (options.onlyLow) conditions.push(`(${IS_LOW_SQL})`);
  if (options.onlyWithoutInitialCount) conditions.push(`(${NEEDS_INITIAL_COUNT_SQL})`);
  if (options.materialId) {
    conditions.push('c.id = ?');
    parameters.push(options.materialId);
  }

  let sql = `${STOCK_SELECT}
WHERE ${conditions.join(' AND ')}
ORDER BY CASE WHEN ${IS_LOW_SQL} THEN 0 ELSE 1 END, c.name COLLATE NOCASE ASC, c.code ASC`;
  if (options.limit !== undefined) {
    sql += ' LIMIT ?';
    parameters.push(options.limit);
  }
  return { sql, parameters };
}

/** Movimientos de un material, del más reciente al más antiguo. */
export const MOVEMENT_HISTORY_SQL =
  'SELECT * FROM material_stock_movements WHERE material_id = ? ORDER BY created_at DESC, id DESC LIMIT ?';

/** ¿Hay compras o ajustes de este dispositivo sin subir? */
export const PENDING_MOVEMENTS_COUNT_SQL = `SELECT count(*) AS count FROM material_stock_movements WHERE sync_status IN ${PENDING_STATES_SQL}`;

/** Material activo del catálogo por id. */
export const ACTIVE_CATALOG_MATERIAL_SQL =
  'SELECT id, unit FROM material_catalog WHERE id = ? AND is_active = 1 LIMIT 1';

/** Alta local de una compra o un ajuste. */
export const INSERT_STOCK_MOVEMENT_SQL = `INSERT INTO material_stock_movements
  (id, material_id, kind, quantity, note, created_by, sync_status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Cambio local del mínimo de bodega (solo esa columna: es lo único que se sube
 * del catálogo). Si el valor no cambia no se escribe nada (no se encola una
 * subida vacía). Parámetros: mínimo, id, mínimo.
 */
export const UPDATE_MIN_STOCK_SQL =
  'UPDATE material_catalog SET min_stock = ? WHERE id = ? AND min_stock IS NOT ?';

/**
 * Consumo por material del catálogo en un rango de fechas: suma de
 * `visit_materials.quantity` de las visitas cuya fecha (`completed_at` o, si
 * no está terminada, `created_at`) cae en [desde, hasta]. Los materiales
 * personalizados no son de bodega y no cuentan.
 *
 * Se compara con `julianday` porque las fechas del servidor y las escritas
 * por la app pueden diferir en el formato (espacio o "T" entre fecha y hora).
 *
 * Solo ve las visitas sincronizadas en este dispositivo: el técnico, las
 * suyas (stream `mis_visitas`); admin y oficina, todas (stream
 * `visitas_de_oficina`). Ver docs/BACKEND.md.
 */
export const CONSUMPTION_SQL = `
SELECT vm.material_id AS material_id,
       coalesce(c.code, vm.material_code) AS code,
       coalesce(c.name, vm.material_name) AS name,
       coalesce(c.unit, vm.unit) AS unit,
       sum(vm.quantity) AS quantity,
       count(DISTINCT vm.visit_id) AS visit_count
FROM visit_materials vm
JOIN visits v ON v.id = vm.visit_id
LEFT JOIN material_catalog c ON c.id = vm.material_id
WHERE coalesce(vm.is_custom, 0) = 0
  AND vm.material_id IS NOT NULL
  AND julianday(coalesce(v.completed_at, v.created_at)) >= julianday(?)
  AND julianday(coalesce(v.completed_at, v.created_at)) <= julianday(?)
GROUP BY vm.material_id
ORDER BY quantity DESC, name COLLATE NOCASE ASC`;

/** Fecha de una visita para el inventario: finalización o, si no terminó, creación. */
const VISIT_DATE_SQL = 'coalesce(v.completed_at, v.created_at)';

/**
 * Uso de un material del catálogo por visita: UNA fila por visita (si en la
 * misma visita se agregó en varias líneas, se suma dentro de esa visita),
 * de la más reciente a la más antigua. Los personalizados no son de bodega.
 * Parámetros: material, límite.
 */
export const MATERIAL_USAGE_BY_VISIT_SQL = `
SELECT vm.visit_id AS visit_id, v.title, v.client_name, v.status, v.technician_id,
       ${VISIT_DATE_SQL} AS visit_date,
       (SELECT coalesce(p.full_name, p.email) FROM profiles p
         WHERE p.id = v.technician_id) AS technician_name,
       sum(vm.quantity) AS quantity,
       coalesce((SELECT c.unit FROM material_catalog c WHERE c.id = vm.material_id), max(vm.unit)) AS unit
FROM visit_materials vm
JOIN visits v ON v.id = vm.visit_id
WHERE vm.material_id = ? AND coalesce(vm.is_custom, 0) = 0
GROUP BY vm.visit_id
ORDER BY julianday(${VISIT_DATE_SQL}) DESC, v.created_at DESC, vm.visit_id ASC
LIMIT ?`;

/** Total de un material en todas las visitas del teléfono. Parámetro: material. */
export const MATERIAL_USAGE_TOTAL_SQL = `
SELECT coalesce(sum(vm.quantity), 0) AS total, count(DISTINCT vm.visit_id) AS visit_count
FROM visit_materials vm
JOIN visits v ON v.id = vm.visit_id
WHERE vm.material_id = ? AND coalesce(vm.is_custom, 0) = 0`;
