import { PowerSyncContext } from '@powersync/react';
import type { PowerSyncDatabase } from '@powersync/react-native';
import { useEffect, useState, type ReactNode } from 'react';

import { ErrorScreen, LoadingScreen } from '@/components/ui';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';

import { prepareSessionDatabase, releaseSessionDatabase } from '../session-database';
import { startSyncMonitor } from '../sync-monitor';

const log = scopedLogger('db');

type ProviderState =
  { phase: 'opening' } | { phase: 'ready'; db: PowerSyncDatabase } | { phase: 'failed' };

export interface DatabaseProviderProps {
  userId: string;
  isDemo: boolean;
  children: ReactNode;
}

/**
 * Abre la base local de la sesión y la pone a disposición de las pantallas.
 *
 * La base se abre DESPUÉS de iniciar sesión (no al arrancar la app) y se
 * cierra al salir. Abrirla no requiere red, así que funciona sin conexión.
 */
export function DatabaseProvider({ userId, isDemo, children }: DatabaseProviderProps) {
  const [state, setState] = useState<ProviderState>({ phase: 'opening' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let stopMonitor: (() => void) | null = null;

    prepareSessionDatabase(userId, isDemo)
      .then((db) => {
        if (!active) return;
        stopMonitor = startSyncMonitor(db, { isDemo });
        setState({ phase: 'ready', db });
      })
      .catch((error: unknown) => {
        log.error('No se pudo abrir la base de datos local', error);
        if (active) setState({ phase: 'failed' });
      });

    return () => {
      active = false;
      stopMonitor?.();
      void releaseSessionDatabase().catch((error: unknown) =>
        log.warn('No se pudo cerrar la base de datos local', error),
      );
    };
  }, [userId, isDemo, attempt]);

  if (state.phase === 'failed') {
    return (
      <ErrorScreen
        message={DEFAULT_ERROR_MESSAGES.database}
        onRetry={() => {
          setState({ phase: 'opening' });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  if (state.phase === 'opening') {
    return <LoadingScreen message="Preparando tus datos..." />;
  }

  return <PowerSyncContext.Provider value={state.db}>{children}</PowerSyncContext.Provider>;
}
