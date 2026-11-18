import { UpdateType, type CrudEntry } from '@powersync/react-native';

/**
 * Lógica de subida de cambios locales a Supabase.
 *
 * Es código puro (sin dependencias nativas): recibe la cola de cambios y un
 * "escritor remoto", lo que permite probarlo sin dispositivo ni red.
 */

/** Tablas que el técnico puede escribir según las políticas RLS del servidor. */
export const WRITABLE_TABLES: ReadonlySet<string> = new Set([
  'visits',
  'form_responses',
  'visit_materials',
  'photos',
  'annotations',
]);

/** Columnas JSONB en PostgreSQL que localmente son texto con JSON serializado. */
const JSON_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  form_responses: ['responses'],
  annotations: ['elements'],
  form_templates: ['sections_json'],
};

/** Columnas BOOLEAN en PostgreSQL que localmente son enteros 1/0. */
const BOOLEAN_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  form_responses: ['is_complete'],
  visit_materials: ['is_custom'],
};

/** Tablas cuya columna `sync_status` usa el enum general de sincronización. */
const SYNC_STATUS_TABLES: ReadonlySet<string> = new Set([
  'visits',
  'form_responses',
  'visit_materials',
  'annotations',
]);

const UNSYNCED_STATES: ReadonlySet<unknown> = new Set([
  'local',
  'pendingSync',
  'syncing',
  'syncError',
]);

export type RowData = Record<string, unknown>;

/**
 * Adapta una fila local al formato del servidor:
 * - JSON en texto → objeto (para columnas JSONB)
 * - 1/0 → true/false (para columnas BOOLEAN)
 * - `sync_status` pendiente → `synced`: si el servidor acepta la fila, ya está
 *   sincronizada, y ese valor vuelve al dispositivo en la siguiente descarga.
 */
export function toRemoteRow(table: string, data: RowData): RowData {
  const row: RowData = { ...data };

  for (const name of JSON_COLUMNS[table] ?? []) {
    const value = row[name];
    if (typeof value === 'string') {
      try {
        row[name] = JSON.parse(value);
      } catch {
        // Se envía tal cual; el servidor lo rechazará y quedará registrado.
      }
    }
  }

  for (const name of BOOLEAN_COLUMNS[table] ?? []) {
    const value = row[name];
    if (value === 1 || value === 0) row[name] = value === 1;
  }

  if (SYNC_STATUS_TABLES.has(table) && UNSYNCED_STATES.has(row.sync_status)) {
    row.sync_status = 'synced';
  }

  return row;
}

export interface RemoteError {
  code?: string;
  message: string;
}

export interface RemoteResult {
  error: RemoteError | null;
}

/** Operaciones de escritura contra el servidor (implementadas con Supabase). */
export interface RemoteWriter {
  upsert(table: string, row: RowData): Promise<RemoteResult>;
  update(table: string, id: string, changes: RowData): Promise<RemoteResult>;
  remove(table: string, id: string): Promise<RemoteResult>;
}

/**
 * Códigos de PostgreSQL que indican un rechazo definitivo: reintentar no
 * lo arreglará (datos inválidos, restricciones, permisos).
 *   22xxx datos inválidos · 23xxx restricciones de integridad · 42501 sin permiso (RLS)
 */
const FATAL_CODE_PATTERNS: readonly RegExp[] = [/^22...$/, /^23...$/, /^42501$/];

export function isFatalRemoteError(error: RemoteError): boolean {
  const code = error.code;
  return typeof code === 'string' && FATAL_CODE_PATTERNS.some((pattern) => pattern.test(code));
}

/** Cambio que el servidor rechazó de forma definitiva. */
export interface SyncIssue {
  table: string;
  rowId: string;
  operation: UpdateType;
  code: string;
  message: string;
  payload: RowData | null;
}

/** Transacción pendiente de subir (subconjunto de `CrudTransaction`). */
export interface PendingTransaction {
  crud: readonly CrudEntry[];
  complete: () => Promise<void>;
}

export interface UploadSource {
  getNextCrudTransaction: () => Promise<PendingTransaction | null>;
}

export interface UploadOutcome {
  uploaded: number;
  issues: SyncIssue[];
}

/** Error temporal: PowerSync reintentará la subida más tarde. */
export class RetryableUploadError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RetryableUploadError';
  }
}

async function applyEntry(entry: CrudEntry, remote: RemoteWriter): Promise<RemoteResult> {
  switch (entry.op) {
    case UpdateType.PUT:
      return remote.upsert(entry.table, {
        ...toRemoteRow(entry.table, entry.opData ?? {}),
        id: entry.id,
      });
    case UpdateType.PATCH:
      return remote.update(entry.table, entry.id, toRemoteRow(entry.table, entry.opData ?? {}));
    case UpdateType.DELETE:
      return remote.remove(entry.table, entry.id);
  }
}

/**
 * Sube la siguiente transacción pendiente.
 *
 * - Rechazo definitivo del servidor → se registra como incidencia y se continúa,
 *   para que un dato inválido no bloquee el resto de la cola.
 * - Error temporal (red, servidor caído) → se lanza un error y la transacción
 *   queda en la cola; nada se pierde.
 *
 * Las subidas son idempotentes: PUT es un upsert por `id`.
 */
export async function uploadNextTransaction(
  source: UploadSource,
  remote: RemoteWriter,
  recordIssue: (issue: SyncIssue) => Promise<void>,
): Promise<UploadOutcome | null> {
  const transaction = await source.getNextCrudTransaction();
  if (!transaction) return null;

  const issues: SyncIssue[] = [];
  let uploaded = 0;

  for (const entry of transaction.crud) {
    if (!WRITABLE_TABLES.has(entry.table)) {
      issues.push({
        table: entry.table,
        rowId: entry.id,
        operation: entry.op,
        code: 'READ_ONLY_TABLE',
        message: 'Esta información solo puede modificarla un administrador.',
        payload: entry.opData ?? null,
      });
      continue;
    }

    const { error } = await applyEntry(entry, remote);
    if (!error) {
      uploaded += 1;
      continue;
    }

    if (!isFatalRemoteError(error)) {
      throw new RetryableUploadError(error.message, error.code);
    }

    issues.push({
      table: entry.table,
      rowId: entry.id,
      operation: entry.op,
      code: error.code ?? 'UNKNOWN',
      message: error.message,
      payload: entry.opData ?? null,
    });
  }

  // Las incidencias se guardan antes de confirmar la transacción.
  for (const issue of issues) {
    await recordIssue(issue);
  }
  await transaction.complete();

  return { uploaded, issues };
}
