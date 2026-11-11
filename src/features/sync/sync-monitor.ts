import { SECURE_KEYS } from '@/constants/app.constants';
import { isOnline, subscribeConnectivity } from '@/services/connectivity/connectivity.service';
import { setSecureItem } from '@/services/storage/secure-storage';
import { useSyncStore } from '@/store/sync.store';
import { scopedLogger } from '@/utils/logger';

import { deriveSyncState } from './sync-state';

const log = scopedLogger('sync');

/** Parte del estado de PowerSync que usa el monitor. */
export interface SyncStatusLike {
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

/** Parte de la base de datos PowerSync que usa el monitor. */
export interface SyncMonitorSource {
  currentStatus: SyncStatusLike;
  registerListener: (listener: { statusChanged?: (status: SyncStatusLike) => void }) => () => void;
  getUploadQueueStats: () => Promise<{ count: number }>;
  /** Avisa cuando cambia alguna de las tablas indicadas. */
  onChange: (
    handler: { onChange: () => void | Promise<void>; onError?: (error: Error) => void },
    options: { tables: string[]; signal: AbortSignal; throttleMs?: number },
  ) => unknown;
}

/** Tablas cuyas escrituras generan cambios por subir. */
const WATCHED_TABLES = ['visits', 'form_responses', 'visit_materials', 'photos', 'annotations'];

/**
 * Mantiene el store de sincronización al día mientras la base está abierta.
 * Reacciona a tres fuentes: el estado de PowerSync, la conectividad del
 * dispositivo y los cambios locales pendientes de subir.
 *
 * Devuelve la función para detenerlo.
 */
export function startSyncMonitor(
  source: SyncMonitorSource,
  options: { isDemo: boolean },
): () => void {
  let status = source.currentStatus;
  let pendingCount = 0;
  let stopped = false;
  let savedLastSync: string | null = null;
  const abort = new AbortController();

  const publish = () => {
    if (stopped) return;
    const flow = status.dataFlowStatus;
    const lastSyncedAt = status.lastSyncedAt?.toISOString() ?? null;

    useSyncStore.getState().setSnapshot({
      state: deriveSyncState({
        isDemo: options.isDemo,
        isOnline: isOnline(),
        connected: status.connected,
        connecting: status.connecting,
        uploading: Boolean(flow.uploading),
        downloading: Boolean(flow.downloading),
        hasError: Boolean(flow.uploadError ?? flow.downloadError),
        pendingCount,
      }),
      pendingCount,
      lastSyncedAt,
    });

    if (lastSyncedAt && lastSyncedAt !== savedLastSync) {
      savedLastSync = lastSyncedAt;
      void setSecureItem(SECURE_KEYS.lastSync, lastSyncedAt).catch((error: unknown) =>
        log.warn('No se pudo guardar la fecha de la última sincronización', error),
      );
    }
  };

  const refreshPending = async () => {
    // En modo demo nada se sube: no hay "pendientes" que mostrar.
    if (options.isDemo) return;
    try {
      const stats = await source.getUploadQueueStats();
      pendingCount = stats.count;
      publish();
    } catch (error) {
      if (!stopped) log.warn('No se pudo contar los cambios pendientes', error);
    }
  };

  const stopStatus = source.registerListener({
    statusChanged: (next) => {
      status = next;
      publish();
      // Al terminar una subida la cola cambia sin que cambien las tablas.
      void refreshPending();
    },
  });
  const stopConnectivity = subscribeConnectivity(publish);

  source.onChange(
    {
      onChange: () => refreshPending(),
      onError: (error) => log.warn('Fallo al observar cambios locales', error),
    },
    { tables: WATCHED_TABLES, signal: abort.signal, throttleMs: 250 },
  );

  publish();
  void refreshPending();

  return () => {
    stopped = true;
    abort.abort();
    stopStatus();
    stopConnectivity();
    useSyncStore.getState().reset();
  };
}
