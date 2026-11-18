import * as Location from 'expo-location';

import { scopedLogger } from '@/utils/logger';

import { validLocation, type PhotoLocation } from './photo-stamp';

const log = scopedLogger('photos');

/**
 * Ubicación del dispositivo para la marca de las fotos tomadas con la cámara.
 *
 * Solo "mientras se usa la app" (nunca en segundo plano). Nunca lanza ni
 * bloquea la foto: sin permiso, sin GPS o si tarda demasiado devuelve `null`
 * y la foto se guarda con "Ubicación no disponible".
 */

/** Espera máxima por una posición nueva. */
export const LOCATION_TIMEOUT_MS = 8000;
/** Una última posición conocida más reciente que esto se usa sin esperar al GPS. */
export const LAST_KNOWN_MAX_AGE_MS = 2 * 60 * 1000;

/** Funciones de expo-location que se usan (inyectables en tests). */
export interface LocationDeps {
  requestPermission: () => Promise<boolean>;
  lastKnown: (maxAgeMs: number) => Promise<Location.LocationObject | null>;
  current: () => Promise<Location.LocationObject>;
}

export const deviceLocationDeps: LocationDeps = {
  requestPermission: async () =>
    (await Location.requestForegroundPermissionsAsync()).status === 'granted',
  lastKnown: (maxAgeMs) => Location.getLastKnownPositionAsync({ maxAge: maxAgeMs }),
  current: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
};

/**
 * Pide el permiso de ubicación (el sistema solo pregunta la primera vez).
 * Devuelve `false` si se deniega o si falla la petición.
 */
export async function requestPhotoLocationPermission(
  deps: Pick<LocationDeps, 'requestPermission'> = deviceLocationDeps,
): Promise<boolean> {
  try {
    return await deps.requestPermission();
  } catch (error) {
    log.warn('No se pudo pedir el permiso de ubicación', error);
    return false;
  }
}

const toPhotoLocation = (position: Location.LocationObject | null): PhotoLocation | null =>
  position
    ? validLocation(
        position.coords.latitude,
        position.coords.longitude,
        position.coords.accuracy ?? null,
      )
    : null;

/** Promesa que se resuelve con `null` si la original tarda más de `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Posición actual del dispositivo (el permiso ya debe estar concedido):
 * la última conocida si tiene menos de 2 minutos; si no, una nueva con un
 * máximo de 8 s de espera. `null` si no se obtiene.
 */
export async function currentPhotoLocation(
  deps: Pick<LocationDeps, 'lastKnown' | 'current'> = deviceLocationDeps,
  options: { timeoutMs?: number; maxAgeMs?: number } = {},
): Promise<PhotoLocation | null> {
  const timeoutMs = options.timeoutMs ?? LOCATION_TIMEOUT_MS;
  const maxAgeMs = options.maxAgeMs ?? LAST_KNOWN_MAX_AGE_MS;
  try {
    const recent = toPhotoLocation(await deps.lastKnown(maxAgeMs));
    if (recent) return recent;
  } catch (error) {
    log.warn('No se pudo leer la última ubicación conocida', error);
  }
  try {
    const position = await withTimeout(deps.current(), timeoutMs);
    if (!position) log.info('El GPS no respondió a tiempo; la foto se guarda sin ubicación');
    return toPhotoLocation(position);
  } catch (error) {
    log.warn('No se pudo obtener la ubicación', error);
    return null;
  }
}
