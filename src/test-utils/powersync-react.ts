import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { TestDatabase } from './test-database';

/**
 * Sustituto de `@powersync/react` para los tests, sobre la base SQLite real
 * de `test-database.ts`. Uso en un archivo de tests:
 *
 *   jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
 *
 * - `PowerSyncContext` es un contexto de React real: `DatabaseProvider` lo usa tal cual.
 * - `usePowerSync()` devuelve la base del contexto o, si no hay proveedor, la
 *   fijada con `setTestDatabase()`.
 * - `useQuery(sql, parámetros)` EJECUTA el SQL real y se vuelve a ejecutar
 *   cada vez que se confirma una escritura (como las consultas reactivas de
 *   PowerSync). Diferencia: aquí el resultado es síncrono, así que nunca hay
 *   un estado "cargando" (`isLoading` siempre es `false`).
 */

export const PowerSyncContext = createContext<TestDatabase | null>(null);

let fallback: TestDatabase | null = null;

/** Base que usan `usePowerSync`/`useQuery` cuando no hay proveedor. */
export function setTestDatabase(db: TestDatabase | null): void {
  fallback = db;
}

export function usePowerSync(): TestDatabase {
  const db = useContext(PowerSyncContext) ?? fallback;
  if (!db) throw new Error('No hay base de datos de test: usa setTestDatabase() o un proveedor.');
  return db;
}

export interface TestQueryState<T> {
  data: T[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | undefined;
  refresh: () => Promise<void>;
}

export function useQuery<T = Record<string, unknown>>(
  sql: string,
  parameters: readonly unknown[] = [],
): TestQueryState<T> {
  const db = usePowerSync();
  const version = useSyncExternalStore(db.subscribe, db.getVersion);
  const [refreshes, setRefreshes] = useState(0);
  const key = JSON.stringify(parameters);

  const result = useMemo(() => {
    // `version` y `refreshes` solo fuerzan la nueva ejecución.
    void version;
    void refreshes;
    try {
      return { data: db.querySync<T>(sql, JSON.parse(key) as unknown[]), error: undefined };
    } catch (error) {
      return { data: [] as T[], error: error instanceof Error ? error : new Error(String(error)) };
    }
  }, [db, sql, key, version, refreshes]);

  const refresh = useCallback(async () => {
    setRefreshes((count) => count + 1);
  }, []);

  return { ...result, isLoading: false, isFetching: false, refresh };
}

/** Proveedor de conveniencia para montar componentes con una base de test. */
export function TestPowerSyncProvider({ db, children }: { db: TestDatabase; children: ReactNode }) {
  return createElement(PowerSyncContext.Provider, { value: db }, children);
}
