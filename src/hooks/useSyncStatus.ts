import { useMemo } from 'react';

import { describeSyncState, type SyncState, type SyncStateInfo } from '@/features/sync/sync-state';
import { useSyncStore } from '@/store/sync.store';

export interface SyncStatusView extends SyncStateInfo {
  state: SyncState;
  pendingCount: number;
  lastSyncedAt: string | null;
}

/** Estado de sincronización listo para mostrar (textos, color e icono). */
export function useSyncStatus(): SyncStatusView {
  const state = useSyncStore((store) => store.state);
  const pendingCount = useSyncStore((store) => store.pendingCount);
  const lastSyncedAt = useSyncStore((store) => store.lastSyncedAt);

  return useMemo(
    () => ({ state, pendingCount, lastSyncedAt, ...describeSyncState(state, pendingCount) }),
    [state, pendingCount, lastSyncedAt],
  );
}
