import type { AnnotationDatabase } from '../services/annotation.service';

/**
 * Base de datos falsa en memoria para los tests de anotaciones
 * (tablas `visits` y `annotations`). No es un archivo de tests.
 */

export type Row = Record<string, unknown>;

export const visitRow = (overrides: Row = {}): Row => ({
  id: 'v1',
  technician_id: 't1',
  status: 'inProgress',
  ...overrides,
});

const ANNOTATION_COLUMNS = [
  'id',
  'visit_id',
  'title',
  'elements',
  'base_image_path',
  'canvas_width',
  'canvas_height',
  'sync_status',
  'created_at',
  'updated_at',
] as const;

type Table = Map<string, Row>;
const toTable = (rows: Row[]): Table => new Map(rows.map((row) => [String(row.id), { ...row }]));
const copy = (table: Table): Table => new Map([...table].map(([id, row]) => [id, { ...row }]));

/** Base falsa para `annotation.service`: transacción con deshacer si algo falla. */
export function createAnnotationDb({
  visits = [visitRow()],
  annotations = [],
}: { visits?: Row[]; annotations?: Row[] } = {}) {
  const tables = { visits: toTable(visits), annotations: toTable(annotations) };
  const statements: string[] = [];
  let failure: Error | null = null;

  const db: AnnotationDatabase = {
    writeTransaction: async (callback) => {
      // Copias de trabajo: si la transacción falla, no se aplica nada.
      const draft = { visits: copy(tables.visits), annotations: copy(tables.annotations) };
      const result = await callback({
        getOptional: async <T>(sql: string, parameters: unknown[] = []) => {
          if (sql.includes('FROM visits')) {
            const visit = draft.visits.get(String(parameters[0]));
            const own = visit && visit.technician_id === parameters[1];
            return (own ? visit : null) as T | null;
          }
          const found = [...draft.annotations.values()].find(
            (row) => row.visit_id === parameters[0],
          );
          return (found ?? null) as T | null;
        },
        execute: async (sql, parameters = []) => {
          if (failure) {
            const error = failure;
            failure = null;
            throw error;
          }
          statements.push(sql);
          if (sql.includes('INSERT INTO annotations')) {
            const row: Row = {};
            ANNOTATION_COLUMNS.forEach((column, index) => {
              row[column] = parameters[index];
            });
            draft.annotations.set(String(row.id), row);
          } else if (sql.includes('UPDATE annotations')) {
            const [elements, canvas_width, canvas_height, sync_status, updated_at, id] = parameters;
            Object.assign(draft.annotations.get(String(id)) ?? {}, {
              elements,
              canvas_width,
              canvas_height,
              sync_status,
              updated_at,
            });
          }
        },
      });
      for (const key of ['visits', 'annotations'] as const) {
        tables[key].clear();
        draft[key].forEach((row, id) => tables[key].set(id, row));
      }
      return result;
    },
  };

  return {
    db,
    rows: tables.annotations,
    statements,
    /** Hace fallar la siguiente escritura. */
    failNextWrite: (error: Error) => {
      failure = error;
    },
  };
}
