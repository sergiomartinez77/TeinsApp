import { useSyncExternalStore } from 'react';

import { isOnline, subscribeConnectivity } from '@/services/connectivity/connectivity.service';

/** `true` si el dispositivo tiene conexión. Se actualiza solo al cambiar la red. */
export function useConnectivity(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOnline, isOnline);
}
