import { create } from 'zustand';

import type { SyncState } from '@/features/sync/sync-state';

export interface SyncSnapshot {
  state: SyncState;
  /** Cambios locales aún sin subir al servidor. */
  pendingCount: number;
  /** Última sincronización completa (ISO 8601), si la hubo. */
  lastSyncedAt: string | null;
}

export interface SyncStoreState extends SyncSnapshot {
  setSnapshot: (snapshot: SyncSnapshot) => void;
  reset: () => void;
}

const INITIAL: SyncSnapshot = {
  // Hasta conocer el estado real se muestra "sincronizando", no un error.
  state: 'syncing',
  pendingCount: 0,
  lastSyncedAt: null,
};

/** Estado global de sincronización. Lo alimenta el monitor de sincronización. */
export const useSyncStore = create<SyncStoreState>((set, get) => ({
  ...INITIAL,
  setSnapshot: (snapshot) => {
    const current = get();
    // Evita renders innecesarios cuando nada cambió.
    if (
      current.state === snapshot.state &&
      current.pendingCount === snapshot.pendingCount &&
      current.lastSyncedAt === snapshot.lastSyncedAt
    ) {
      return;
    }
    set(snapshot);
  },
  reset: () => set(INITIAL),
}));
