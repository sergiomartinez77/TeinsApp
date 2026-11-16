import type { PhotoFileSystem } from '../services/photo-files';
import type { PhotoDatabase } from '../services/photo.service';

/**
 * Base de datos y sistema de archivos falsos en memoria para los tests de
 * fotografías (tablas `visits` y `photos`). No es un archivo de tests.
 */

export type Row = Record<string, unknown>;

export const visitRow = (overrides: Row = {}): Row => ({
  id: 'v1',
  technician_id: 't1',
  status: 'inProgress',
  ...overrides,
});

export const photoRow = (overrides: Row = {}): Row => ({
  id: 'p1',
  visit_id: 'v1',
  form_field_id: null,
  local_path: 'teins_photos/p1.jpg',
  storage_path: null,
  storage_url: null,
  caption: null,
  sync_status: 'local',
  captured_at: '2026-06-01T08:00:00.000Z',
  uploaded_at: null,
  file_size_bytes: 1000,
  width: 1920,
  height: 1080,
  ...overrides,
});

const PHOTO_COLUMNS = [
  'id',
  'visit_id',
  'form_field_id',
  'local_path',
  'storage_path',
  'storage_url',
  'caption',
  'sync_status',
  'captured_at',
  'uploaded_at',
  'file_size_bytes',
  'width',
  'height',
] as const;

type Table = Map<string, Row>;
const toTable = (rows: Row[]): Table => new Map(rows.map((row) => [String(row.id), { ...row }]));
const copy = (table: Table): Table => new Map([...table].map(([id, row]) => [id, { ...row }]));

/** Base falsa para `photo.service`: transacción con deshacer si algo falla. */
export function createPhotoDb({
  visits = [visitRow()],
  photos = [],
}: { visits?: Row[]; photos?: Row[] } = {}) {
  const tables = { visits: toTable(visits), photos: toTable(photos) };
  let failNextWrite: Error | null = null;

  const db: PhotoDatabase = {
    writeTransaction: async (callback) => {
      const draft = { visits: copy(tables.visits), photos: copy(tables.photos) };
      const result = await callback({
        getOptional: async <T>(sql: string, parameters: unknown[] = []) => {
          const [first, second] = parameters;
          let found: Row | undefined;
          if (sql.includes('FROM visits')) {
            const visit = draft.visits.get(String(first));
            found = visit && visit.technician_id === second ? visit : undefined;
          } else {
            const photo = draft.photos.get(String(first));
            found = photo && photo.visit_id === second ? photo : undefined;
          }
          return (found ?? null) as T | null;
        },
        execute: async (sql, parameters = []) => {
          if (failNextWrite) {
            const error = failNextWrite;
            failNextWrite = null;
            throw error;
          }
          if (sql.includes('INSERT INTO photos')) {
            const row: Row = {};
            PHOTO_COLUMNS.forEach((column, index) => {
              row[column] = parameters[index];
            });
            draft.photos.set(String(row.id), row);
          } else if (sql.includes('DELETE FROM photos')) {
            draft.photos.delete(String(parameters[0]));
          } else {
            throw new Error(`Sentencia no esperada en la base falsa: ${sql}`);
          }
        },
      });
      tables.visits = draft.visits;
      tables.photos = draft.photos;
      return result;
    },
  };

  return {
    db,
    photos: () => tables.photos,
    /** Hace fallar la siguiente escritura (y deshace la transacción). */
    failNextWrite: (error: Error) => {
      failNextWrite = error;
    },
  };
}

/**
 * Sistema de archivos falso: rutas relativas → tamaño en bytes, más la
 * papelera temporal (nombre → tamaño).
 */
export function createFakeFiles(initial: Record<string, number> = {}) {
  const stored = new Map<string, number>(Object.entries(initial));
  const trash = new Map<string, number>();
  const files: PhotoFileSystem & {
    save: jest.Mock;
    remove: jest.Mock;
    moveToTrash: jest.Mock;
    read: jest.Mock;
  } = {
    save: jest.fn(async (_sourceUri: string, relativePath: string) => {
      stored.set(relativePath, 2048);
      return { size: 2048 };
    }),
    remove: jest.fn(async (relativePath: string) => {
      stored.delete(relativePath);
    }),
    moveToTrash: jest.fn(async (relativePath: string, trashName: string) => {
      const size = stored.get(relativePath);
      if (size === undefined) throw new Error('El archivo no existe');
      stored.delete(relativePath);
      trash.set(trashName, size);
    }),
    exists: (relativePath: string) => stored.has(relativePath),
    read: jest.fn(async () => new ArrayBuffer(8)),
    absoluteUri: (relativePath: string) => `file:///documentos/${relativePath}`,
  };
  return { files, stored, trash };
}
