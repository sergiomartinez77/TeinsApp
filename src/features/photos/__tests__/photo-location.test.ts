import * as Location from 'expo-location';

import {
  currentPhotoLocation,
  deviceLocationDeps,
  LAST_KNOWN_MAX_AGE_MS,
  requestPhotoLocationPermission,
} from '../services/photo-location';

jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const position = (latitude: number, longitude: number, accuracy: number | null = 8) =>
  ({
    timestamp: 0,
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
  }) as Location.LocationObject;

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('requestPhotoLocationPermission', () => {
  it('devuelve true si se concede y false si se deniega', async () => {
    expect(await requestPhotoLocationPermission({ requestPermission: async () => true })).toBe(
      true,
    );
    expect(await requestPhotoLocationPermission()).toBe(false);
  });

  it('si la petición falla no lanza: devuelve false', async () => {
    const result = await requestPhotoLocationPermission({
      requestPermission: async () => {
        throw new Error('servicio no disponible');
      },
    });
    expect(result).toBe(false);
  });

  it('el permiso del dispositivo es solo "mientras se usa la app"', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({
      granted: true,
      status: 'granted' as Location.PermissionStatus,
      canAskAgain: true,
      expires: 'never',
    });
    expect(await deviceLocationDeps.requestPermission()).toBe(true);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
  });
});

describe('currentPhotoLocation', () => {
  it('usa la última posición conocida si es reciente (sin esperar al GPS)', async () => {
    const current = jest.fn();
    const lastKnown = jest.fn(async () => position(-3.99, -79.2, 12));

    expect(await currentPhotoLocation({ lastKnown, current })).toEqual({
      latitude: -3.99,
      longitude: -79.2,
      accuracy: 12,
    });
    expect(lastKnown).toHaveBeenCalledWith(LAST_KNOWN_MAX_AGE_MS);
    expect(current).not.toHaveBeenCalled();
  });

  it('sin posición reciente pide una nueva', async () => {
    const result = await currentPhotoLocation({
      lastKnown: async () => null,
      current: async () => position(4.6, -74.08, null),
    });
    expect(result).toEqual({ latitude: 4.6, longitude: -74.08, accuracy: null });
  });

  it('si el GPS no responde en el tiempo máximo devuelve null', async () => {
    jest.useFakeTimers();
    const pending = currentPhotoLocation(
      { lastKnown: async () => null, current: () => new Promise(() => undefined) },
      { timeoutMs: 8000 },
    );
    await jest.advanceTimersByTimeAsync(8000);
    expect(await pending).toBeNull();
  });

  it('errores del GPS o de la última posición no lanzan', async () => {
    const result = await currentPhotoLocation({
      lastKnown: async () => {
        throw new Error('sin caché');
      },
      current: async () => {
        throw new Error('GPS apagado');
      },
    });
    expect(result).toBeNull();
  });

  it('una posición (0, 0) se descarta', async () => {
    expect(
      await currentPhotoLocation({
        lastKnown: async () => null,
        current: async () => position(0, 0),
      }),
    ).toBeNull();
  });

  it('con expo-location: última conocida con antigüedad máxima y luego posición precisa', async () => {
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce(position(-0.18, -78.47, 5));
    expect(await currentPhotoLocation()).toEqual({
      latitude: -0.18,
      longitude: -78.47,
      accuracy: 5,
    });
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
    });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.High,
    });
  });
});
