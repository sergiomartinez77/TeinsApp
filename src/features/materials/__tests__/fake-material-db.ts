import type { MaterialDatabase } from '../services/material.service';

/**
 * Base de datos falsa en memoria para los tests de materiales
 * (tablas `visits`, `material_catalog` y `visit_materials`). No es un archivo de tests.
 */

export type Row = Record<string, unknown>;

export const visitRow = (overrides: Row = {}): Row => ({
  id: 'v1',
  technician_id: 't1',
  status: 'inProgress',
  ...overrides,
});

export const catalogRow = (overrides: Row = {}): Row => ({
  id: 'm1',
  code: 'CAB-001',
  name: 'Cable UTP Cat6',
  description: null,
  unit: 'metro',
  category: 'Cableado',
  is_active: 1,
  ...overrides,
});

export const visitMaterialRow = (overrides: Row = {}): Row => ({
  id: 'vm1',
  visit_id: 'v1',
  material_id: 'm1',
  material_code: 'CAB-001',
  material_name: 'Cable UTP Cat6',
  unit: 'metro',
  quantity: 10,
  observations: null,
  sync_status: 'synced',
  created_at: '2026-06-01T08:00:00.000Z',
  updated_at: '2026-06-01T08:00:00.000Z',
  ...overrides,
});

type Table = Map<string, Row>;
const toTable = (rows: Row[]): Table => new Map(rows.map((row) => [String(row.id), { ...row }]));
const copy = (table: Table): Table => new Map([...table].map(([id, row]) => [id, { ...row }]));

export function createDb({
  visits = [visitRow()],
  catalog = [catalogRow()],
  materials = [],
}: { visits?: Row[]; catalog?: Row[]; materials?: Row[] } = {}) {
  const tables = {
    visits: toTable(visits),
    catalog: toTable(catalog),
    materials: toTable(materials),
  };
  const statements: string[] = [];
  let failure: { error: Error; after: number } | null = null;

  const db: MaterialDatabase = {
    writeTransaction: async (callback) => {
      // Copias de trabajo: si la transacción falla, no se aplica nada.
      const draft = {
        visits: copy(tables.visits),
        catalog: copy(tables.catalog),
        materials: copy(tables.materials),
      };
      const result = await callback({
        getOptional: async <T>(sql: string, parameters: unknown[] = []) => {
          const [first, second] = parameters;
          let found: Row | undefined;
          if (sql.includes('FROM visits')) {
            const visit = draft.visits.get(String(first));
            found = visit && visit.technician_id === second ? visit : undefined;
          } else if (sql.includes('FROM material_catalog')) {
            found = draft.catalog.get(String(first));
          } else if (sql.includes('material_id = ?')) {
            found = [...draft.materials.values()].find(
              (row) => row.visit_id === first && row.material_id === second,
            );
          } else {
            const row = draft.materials.get(String(first));
            found = row && row.visit_id === second ? row : undefined;
          }
          return (found ?? null) as T | null;
        },
        execute: async (sql, parameters = []) => {
          if (failure) {
            if (failure.after === 0) {
              const { error } = failure;
              failure = null;
              throw error;
            }
            failure.after -= 1;
          }
          statements.push(sql);
          if (sql.includes('INSERT INTO visit_materials')) {
            const [
              id,
              visit_id,
              material_id,
              material_code,
              material_name,
              unit,
              quantity,
              observations,
              sync_status,
              created_at,
              updated_at,
            ] = parameters;
            draft.materials.set(String(id), {
              id,
              visit_id,
              material_id,
              material_code,
              material_name,
              unit,
              quantity,
              observations,
              sync_status,
              created_at,
              updated_at,
            });
          } else if (sql.includes('UPDATE visit_materials')) {
            const [quantity, observations, sync_status, updated_at, id] = parameters;
            Object.assign(draft.materials.get(String(id)) ?? {}, {
              quantity,
              observations,
              sync_status,
              updated_at,
            });
          } else if (sql.includes('DELETE FROM visit_materials')) {
            draft.materials.delete(String(parameters[0]));
          } else {
            throw new Error(`Sentencia no esperada en la base falsa: ${sql}`);
          }
        },
      });
      for (const key of ['visits', 'catalog', 'materials'] as const) {
        tables[key].clear();
        draft[key].forEach((row, id) => tables[key].set(id, row));
      }
      return result;
    },
  };

  return {
    db,
    materials: tables.materials,
    catalog: tables.catalog,
    statements,
    /** Hace fallar una escritura: la siguiente, o la que va tras `after` escrituras. */
    failNextWrite: (error: Error, after = 0) => {
      failure = { error, after };
    },
  };
}
