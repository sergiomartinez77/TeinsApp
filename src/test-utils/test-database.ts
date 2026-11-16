/// <reference types="node" />
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { appSchema } from '@/services/powersync/schema';

/**
 * Base de datos SQLite REAL en memoria para los tests (solo tests: nunca se
 * importa desde código de producción).
 *
 * Motor: el módulo integrado `node:sqlite` de Node 24 (`DatabaseSync`), sin
 * dependencias nuevas. Expone la misma interfaz que la app usa de PowerSync:
 * `execute`, `getAll`, `getOptional`, `get` y `writeTransaction` (con
 * `BEGIN` / `COMMIT` / `ROLLBACK` reales), más lo que necesitan el monitor de
 * sincronización y la sesión (`onChange`, `registerListener`,
 * `getUploadQueueStats`, `connect`, `disconnect`, `disconnectAndClear`, `close`).
 *
 * Las tablas se generan a partir de `appSchema` (incluida `sync_issues`), así
 * que el esquema de los tests no puede desviarse del real.
 *
 * ── Qué se valida y qué no ───────────────────────────────────────────────────
 * Se valida: la sintaxis de cada consulta, su semántica (filtros, `LIKE` con
 * `ESCAPE`, `COALESCE`, subconsultas), el orden y los límites, la afinidad de
 * tipos de las columnas y las transacciones (un fallo a mitad deshace todo).
 *
 * LIMITACIONES CONOCIDAS:
 * - En producción PowerSync expone cada tabla como una VISTA sobre su propio
 *   almacenamiento (JSON en `ps_data__<tabla>`) con disparadores que alimentan
 *   la cola de subida (`ps_crud`). Aquí son tablas normales: NO se valida el
 *   comportamiento interno de PowerSync (cola de subida, descargas,
 *   conversión exacta de tipos de las vistas, `localOnly`).
 * - Hay una sola conexión. Las escrituras se serializan con un cerrojo (como
 *   en PowerSync) y las lecturas de nivel superior esperan a que termine la
 *   transacción en curso, para no ver datos sin confirmar. Las lecturas
 *   síncronas de `useQuery` (ver `powersync-react.ts`) sí podrían ver datos
 *   sin confirmar si se montara un componente a mitad de una transacción.
 * - Los parámetros se convierten como op-sqlite: `true`/`false` → 1/0,
 *   `undefined` → NULL y los números enteros se enlazan como INTEGER (no como
 *   REAL). Cualquier otro tipo no admitido por SQLite lanza.
 * - Los índices de `appSchema` se crean, pero no se mide rendimiento.
 */

export type Row = Record<string, unknown>;

/** Resultado de `execute`, con la forma de `QueryResult` de PowerSync. */
export interface TestQueryResult {
  rowsAffected: number;
  insertId?: number;
  rows: { _array: Row[]; length: number; item: (index: number) => Row | undefined };
}

/** Operaciones disponibles dentro de una transacción (`tx`). */
export interface TestTransaction {
  execute: (sql: string, parameters?: readonly unknown[]) => Promise<TestQueryResult>;
  getAll: <T = Row>(sql: string, parameters?: readonly unknown[]) => Promise<T[]>;
  getOptional: <T = Row>(sql: string, parameters?: readonly unknown[]) => Promise<T | null>;
  get: <T = Row>(sql: string, parameters?: readonly unknown[]) => Promise<T>;
}

/** Estado de sincronización que publica la base (subconjunto de `SyncStatus`). */
export interface TestSyncStatus {
  connected: boolean;
  connecting: boolean;
  lastSyncedAt?: Date;
  dataFlowStatus: {
    uploading?: boolean;
    downloading?: boolean;
    uploadError?: unknown;
    downloadError?: unknown;
  };
}

type ChangeListener = (tables: ReadonlySet<string>) => void;

export interface TestDatabase extends TestTransaction {
  writeTransaction: <T>(callback: (tx: TestTransaction) => Promise<T>) => Promise<T>;
  readTransaction: <T>(callback: (tx: TestTransaction) => Promise<T>) => Promise<T>;
  /** Lectura síncrona (solo para la consulta reactiva falsa de `useQuery`). */
  querySync: <T = Row>(sql: string, parameters?: readonly unknown[]) => T[];
  /** Avisa tras cada `COMMIT` (o escritura suelta) con las tablas modificadas. */
  subscribe: (listener: () => void) => () => void;
  /** Versión de los datos: aumenta en cada cambio confirmado. */
  getVersion: () => number;
  /** Igual que `onChange` de PowerSync (con `handler`). */
  onChange: (
    handler: { onChange: (event: { changedTables: string[] }) => void | Promise<void> },
    options?: { tables?: string[]; signal?: AbortSignal; throttleMs?: number },
  ) => void;

  // ── Ciclo de vida (PowerSync) ──
  currentStatus: TestSyncStatus;
  registerListener: (listener: { statusChanged?: (status: TestSyncStatus) => void }) => () => void;
  getUploadQueueStats: () => Promise<{ count: number }>;
  connect: (connector: unknown) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Como PowerSync: borra TODOS los datos locales. */
  disconnectAndClear: () => Promise<void>;
  close: () => Promise<void>;

  // ── Utilidades para los tests ──
  /** Cambia el estado de sincronización y avisa a los oyentes. */
  setStatus: (status: Partial<TestSyncStatus>) => void;
  /** Fija el número de cambios pendientes que devuelve `getUploadQueueStats`. */
  setUploadQueueCount: (count: number) => void;
  /** Llamadas del ciclo de vida, en orden: `connect`, `disconnect`, `clear`, `close`. */
  readonly events: readonly string[];
  readonly closed: boolean;
  /** Filas de una tabla (lectura directa, sin cerrojo), ordenadas por `id`. */
  rows: (table: string) => Row[];
  /** Inserta filas tal cual (síncrono) y avisa a las consultas reactivas. */
  insert: (table: string, rows: readonly Row[]) => void;
  /** Conexión `node:sqlite` subyacente (p. ej. para crear disparadores de fallo). */
  readonly raw: DatabaseSync;
}

export interface TestDatabaseOptions {
  /** Generador de la función SQL `uuid()`. Por defecto `crypto.randomUUID`. */
  uuid?: () => string;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Sentencias `CREATE TABLE` / `CREATE INDEX` generadas desde `appSchema`. */
export function schemaStatements(): string[] {
  const statements: string[] = [];
  for (const table of appSchema.tables) {
    const columns = table.columns.map((column) => `${quote(column.name)} ${column.type}`);
    statements.push(
      `CREATE TABLE ${quote(table.name)} (id TEXT PRIMARY KEY NOT NULL, ${columns.join(', ')})`,
    );
    for (const index of table.indexes) {
      const indexColumns = index.columns
        .map((column) => `${quote(column.name)} ${column.ascending ? 'ASC' : 'DESC'}`)
        .join(', ');
      statements.push(
        `CREATE INDEX ${quote(`${table.name}__${index.name}`)} ON ${quote(table.name)} (${indexColumns})`,
      );
    }
  }
  return statements;
}

/** Nombres de las tablas de `appSchema`. */
export const SCHEMA_TABLES: readonly string[] = appSchema.tables.map((table) => table.name);

const WRITE_TARGET =
  /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)/i;

/** Tabla que modifica una sentencia de escritura, o `null` si es de lectura. */
export function writtenTable(sql: string): string | null {
  return WRITE_TARGET.exec(sql)?.[1] ?? null;
}

/** Convierte un parámetro como lo haría op-sqlite. */
function toSqlValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  // Los enteros se enlazan como INTEGER (node:sqlite enlaza todo `number` como REAL).
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : value;
  if (typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`Parámetro SQL no admitido: ${Object.prototype.toString.call(value)}`);
}

const plain = (row: unknown): Row => ({ ...(row as Row) });

function queryResult(rows: Row[], rowsAffected: number, insertId?: number): TestQueryResult {
  return {
    rowsAffected,
    insertId,
    rows: { _array: rows, length: rows.length, item: (index) => rows[index] },
  };
}

/** Crea una base SQLite en memoria con el esquema de la app. */
export function createTestDatabase(options: TestDatabaseOptions = {}): TestDatabase {
  const raw = new DatabaseSync(':memory:');
  const uuid = options.uuid ?? randomUUID;
  raw.function('uuid', () => uuid());
  for (const statement of schemaStatements()) raw.exec(statement);

  let version = 0;
  let closed = false;
  let uploadQueueCount = 0;
  const events: string[] = [];
  const listeners = new Set<ChangeListener>();
  const statusListeners = new Set<(status: TestSyncStatus) => void>();
  let currentStatus: TestSyncStatus = { connected: false, connecting: false, dataFlowStatus: {} };

  /** Cerrojo de escritura: una transacción (o escritura suelta) a la vez. */
  let lock: Promise<unknown> = Promise.resolve();
  /** Marca el contexto asíncrono de una transacción abierta. */
  const transactionContext = new AsyncLocalStorage<{ tables: Set<string> }>();

  const withLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = lock.then(operation, operation);
    lock = next.catch(() => undefined);
    return next;
  };

  const assertOpen = () => {
    if (closed) throw new Error('La base de datos de test está cerrada.');
  };

  const notify = (tables: ReadonlySet<string>) => {
    if (tables.size === 0) return;
    version += 1;
    listeners.forEach((listener) => listener(tables));
  };

  /** Ejecuta una sentencia de forma síncrona y anota la tabla modificada. */
  const run = (sql: string, parameters: readonly unknown[], written: Set<string>) => {
    assertOpen();
    const statement = raw.prepare(sql);
    const values = parameters.map(toSqlValue);
    if (statement.columns().length > 0) {
      return queryResult(statement.all(...values).map(plain), 0);
    }
    const outcome = statement.run(...values);
    const table = writtenTable(sql);
    if (table && Number(outcome.changes) > 0) written.add(table);
    return queryResult([], Number(outcome.changes), Number(outcome.lastInsertRowid));
  };

  const select = <T>(sql: string, parameters: readonly unknown[]): T[] =>
    run(sql, parameters, new Set()).rows._array as T[];

  const transaction = (written: Set<string>): TestTransaction => ({
    execute: async (sql, parameters = []) => run(sql, parameters, written),
    getAll: async <T>(sql: string, parameters: readonly unknown[] = []) =>
      select<T>(sql, parameters),
    getOptional: async <T>(sql: string, parameters: readonly unknown[] = []) =>
      select<T>(sql, parameters)[0] ?? null,
    get: async <T>(sql: string, parameters: readonly unknown[] = []) => {
      const [first] = select<T>(sql, parameters);
      if (first === undefined) throw new Error('Result set is empty');
      return first;
    },
  });

  const runTransaction = <T>(callback: (tx: TestTransaction) => Promise<T>): Promise<T> => {
    if (transactionContext.getStore()) {
      // En PowerSync el cerrojo no es reentrante: esto se quedaría bloqueado.
      return Promise.reject(
        new Error('Escritura de nivel superior dentro de una transacción (usa `tx`).'),
      );
    }
    return withLock(async () => {
      assertOpen();
      const written = new Set<string>();
      raw.exec('BEGIN');
      try {
        const result = await transactionContext.run({ tables: written }, () =>
          callback(transaction(written)),
        );
        raw.exec('COMMIT');
        notify(written);
        return result;
      } catch (error) {
        if (raw.isTransaction) raw.exec('ROLLBACK');
        throw error;
      }
    });
  };

  /** Lectura de nivel superior: espera a que termine la escritura en curso. */
  const read = <T>(operation: (tx: TestTransaction) => Promise<T>): Promise<T> => {
    const tx = transaction(new Set());
    // Dentro de una transacción se lee directamente (si no, se bloquearía).
    if (transactionContext.getStore()) return operation(tx);
    return lock.then(() => operation(tx));
  };

  const db: TestDatabase = {
    execute: (sql, parameters = []) => {
      if (writtenTable(sql) === null) return read((tx) => tx.execute(sql, parameters));
      return runTransaction((tx) => tx.execute(sql, parameters));
    },
    getAll: (sql, parameters) => read((tx) => tx.getAll(sql, parameters)),
    getOptional: (sql, parameters) => read((tx) => tx.getOptional(sql, parameters)),
    get: (sql, parameters) => read((tx) => tx.get(sql, parameters)),
    writeTransaction: runTransaction,
    readTransaction: (callback) => read(callback),
    querySync: <T>(sql: string, parameters: readonly unknown[] = []) => select<T>(sql, parameters),
    subscribe: (listener) => {
      const wrapped: ChangeListener = () => listener();
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    getVersion: () => version,
    onChange: (handler, watchOptions = {}) => {
      const tables = watchOptions.tables ? new Set(watchOptions.tables) : null;
      const listener: ChangeListener = (changed) => {
        const changedTables = [...changed].filter((table) => !tables || tables.has(table));
        if (changedTables.length > 0) void handler.onChange({ changedTables });
      };
      listeners.add(listener);
      watchOptions.signal?.addEventListener('abort', () => listeners.delete(listener));
    },

    get currentStatus() {
      return currentStatus;
    },
    registerListener: (listener) => {
      const statusChanged = listener.statusChanged;
      if (!statusChanged) return () => undefined;
      statusListeners.add(statusChanged);
      return () => {
        statusListeners.delete(statusChanged);
      };
    },
    getUploadQueueStats: async () => ({ count: uploadQueueCount }),
    connect: async () => {
      events.push('connect');
    },
    disconnect: async () => {
      events.push('disconnect');
    },
    disconnectAndClear: () =>
      withLock(async () => {
        assertOpen();
        events.push('clear');
        for (const table of SCHEMA_TABLES) raw.exec(`DELETE FROM ${quote(table)}`);
        notify(new Set(SCHEMA_TABLES));
      }),
    close: () =>
      withLock(async () => {
        if (closed) return;
        events.push('close');
        closed = true;
        raw.close();
      }),

    setStatus: (status) => {
      currentStatus = { ...currentStatus, ...status };
      statusListeners.forEach((listener) => listener(currentStatus));
    },
    setUploadQueueCount: (count) => {
      uploadQueueCount = count;
    },
    events,
    get closed() {
      return closed;
    },
    rows: (table) => select<Row>(`SELECT * FROM ${quote(table)} ORDER BY id`, []),
    insert: (table, rows) => {
      assertOpen();
      for (const row of rows) {
        const columns = Object.keys(row);
        const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns
          .map(() => '?')
          .join(', ')})`;
        raw.prepare(sql).run(...columns.map((column) => toSqlValue(row[column])));
      }
      notify(new Set([table]));
    },
    raw,
  };

  return db;
}
