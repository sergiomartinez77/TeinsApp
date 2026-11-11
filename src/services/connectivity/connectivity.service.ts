import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

/**
 * Monitor de conectividad.
 *
 * Estar sin conexión es un estado normal de trabajo, no un error:
 * este servicio solo informa para el banner y para decidir cuándo subir fotos.
 */

type Listener = () => void;

/**
 * Hay conexión si el dispositivo está en una red y no se ha comprobado
 * que Internet sea inalcanzable. `isInternetReachable` puede ser `null`
 * mientras se verifica: en ese caso se asume que sí hay Internet.
 */
export function isOnlineState(
  state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>,
): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

// Hasta recibir el primer estado se asume conexión, para no mostrar
// un aviso de "sin conexión" falso durante el arranque.
let online = true;
let unsubscribeNetInfo: (() => void) | null = null;
const listeners = new Set<Listener>();

function handleState(state: NetInfoState): void {
  const next = isOnlineState(state);
  if (next === online) return;
  online = next;
  listeners.forEach((listener) => listener());
}

/** Empieza a escuchar la red. Es seguro llamarla varias veces. */
export function startConnectivityMonitor(): void {
  if (unsubscribeNetInfo) return;
  unsubscribeNetInfo = NetInfo.addEventListener(handleState);
}

export function stopConnectivityMonitor(): void {
  unsubscribeNetInfo?.();
  unsubscribeNetInfo = null;
}

/** Último estado conocido. */
export function isOnline(): boolean {
  return online;
}

/** Consulta el estado actual al sistema (para verificaciones puntuales). */
export async function checkOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  handleState(state);
  return online;
}

/** Suscribe a los cambios de conexión. Devuelve la función para cancelar. */
export function subscribeConnectivity(listener: Listener): () => void {
  listeners.add(listener);
  startConnectivityMonitor();
  return () => {
    listeners.delete(listener);
  };
}
