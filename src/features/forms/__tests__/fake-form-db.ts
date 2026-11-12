import type { FormResponseDatabase } from '../services/response.service';

/**
 * Base de datos falsa en memoria para los tests de formularios
 * (tablas `visits` y `form_responses`). No es un archivo de tests.
 */

export type Row = Record<string, unknown>;

export const visitRow = (overrides: Row = {}): Row => ({
  id: 'v1',
  status: 'inProgress',
  sync_status: 'synced',
  form_template_id: null,
  form_template_version: null,
  updated_at: '2026-05-30T08:00:00.000Z',
  ...overrides,
});

const copy = (table: Map<string, Row>) => new Map([...table].map(([id, row]) => [id, { ...row }]));

/** Base de datos en memoria con las tablas `visits` y `form_responses`. */
export function createDb({
  visits = [visitRow()],
  responses = [],
}: { visits?: Row[]; responses?: Row[] } = {}) {
  const tables = {
    visits: new Map(visits.map((row) => [String(row.id), { ...row }])),
    responses: new Map(responses.map((row) => [String(row.id), { ...row }])),
  };
  const statements: string[] = [];
  let failure: { error: Error; after: number } | null = null;

  const db: FormResponseDatabase = {
    writeTransaction: async (callback) => {
      // Copias de trabajo: si la transacción falla, no se aplica nada.
      const draft = { visits: copy(tables.visits), responses: copy(tables.responses) };
      const result = await callback({
        getOptional: async <T>(sql: string, parameters: unknown[] = []) => {
          const found = sql.includes('FROM visits')
            ? draft.visits.get(String(parameters[0]))
            : [...draft.responses.values()].find((row) => row.visit_id === parameters[0]);
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
          if (sql.includes('INSERT INTO form_responses')) {
            const [
              id,
              visit_id,
              template_id,
              template_version,
              responses,
              sync_status,
              is_complete,
              created_at,
              updated_at,
              completed_at,
            ] = parameters;
            draft.responses.set(String(id), {
              id,
              visit_id,
              template_id,
              template_version,
              responses,
              sync_status,
              is_complete,
              created_at,
              updated_at,
              completed_at,
            });
          } else if (sql.includes('UPDATE visits')) {
            const id = String(parameters[parameters.length - 1]);
            const changes = sql.includes('form_template_id')
              ? {
                  form_template_id: parameters[0],
                  form_template_version: parameters[1],
                  sync_status: parameters[2],
                  updated_at: parameters[3],
                }
              : {
                  form_template_version: parameters[0],
                  sync_status: parameters[1],
                  updated_at: parameters[2],
                };
            Object.assign(draft.visits.get(id) ?? {}, changes);
          } else if (sql.includes('is_complete = 1')) {
            const [responses, sync_status, updated_at, completed_at, id] = parameters;
            Object.assign(draft.responses.get(String(id)) ?? {}, {
              responses,
              sync_status,
              updated_at,
              completed_at,
              is_complete: 1,
            });
          } else {
            const [responses, sync_status, updated_at, id] = parameters;
            Object.assign(draft.responses.get(String(id)) ?? {}, {
              responses,
              sync_status,
              updated_at,
            });
          }
        },
      });
      for (const key of ['visits', 'responses'] as const) {
        tables[key].clear();
        draft[key].forEach((row, id) => tables[key].set(id, row));
      }
      return result;
    },
  };

  return {
    db,
    rows: tables.responses,
    visits: tables.visits,
    statements,
    /** Hace fallar una escritura: la siguiente, o la que va tras `after` escrituras. */
    failNextWrite: (error: Error, after = 0) => {
      failure = { error, after };
    },
  };
}
