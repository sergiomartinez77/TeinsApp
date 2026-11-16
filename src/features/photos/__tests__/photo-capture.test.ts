import * as ImagePicker from 'expo-image-picker';

import {
  captureImage,
  compressImage,
  PHOTO_CAPTURE_MESSAGES,
  type CompressionDeps,
} from '../services/photo-capture';

jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const MB = 1024 * 1024;

/** Manipulador falso: el tamaño del archivo depende de la calidad elegida. */
function fakeCompression(sizeForQuality: (quality: number) => number) {
  const sizes = new Map<string, number>();
  const deps: CompressionDeps & { render: jest.Mock; discard: jest.Mock } = {
    render: jest.fn(async (_uri: string, size: { width: number; height: number } | null) => {
      const width = size?.width ?? 800;
      const height = size?.height ?? 600;
      return {
        width,
        height,
        save: async (quality: number) => {
          const uri = `file:///cache/salida-${quality}.jpg`;
          sizes.set(uri, sizeForQuality(quality));
          return { uri, width, height };
        },
        release: jest.fn(),
      };
    }),
    fileSize: (uri) => sizes.get(uri) ?? 0,
    discard: jest.fn(),
  };
  return deps;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('compressImage', () => {
  it('redimensiona una foto grande y guarda en JPEG 0,85', async () => {
    const deps = fakeCompression(() => 2 * MB);

    const result = await compressImage(
      { uri: 'file:///foto.jpg', width: 4000, height: 3000 },
      deps,
    );

    expect(deps.render).toHaveBeenCalledWith('file:///foto.jpg', { width: 1440, height: 1080 });
    expect(result).toEqual({
      ok: true,
      data: { uri: 'file:///cache/salida-0.85.jpg', width: 1440, height: 1080, sizeBytes: 2 * MB },
    });
  });

  it('no redimensiona una foto pequeña', async () => {
    const deps = fakeCompression(() => MB);
    await compressImage({ uri: 'file:///foto.jpg', width: 800, height: 600 }, deps);
    expect(deps.render).toHaveBeenCalledWith('file:///foto.jpg', null);
  });

  it('si supera 5 MB reintenta con calidad 0,7 y luego 0,5', async () => {
    const deps = fakeCompression((quality) => (quality > 0.5 ? 6 * MB : 4 * MB));

    const result = await compressImage(
      { uri: 'file:///foto.jpg', width: 1920, height: 1080 },
      deps,
    );

    expect(result.ok && result.data.uri).toBe('file:///cache/salida-0.5.jpg');
    expect(deps.discard).toHaveBeenCalledWith('file:///cache/salida-0.85.jpg');
    expect(deps.discard).toHaveBeenCalledWith('file:///cache/salida-0.7.jpg');
  });

  it('si con calidad 0,5 aún supera 5 MB devuelve un error', async () => {
    const deps = fakeCompression(() => 6 * MB);

    const result = await compressImage(
      { uri: 'file:///foto.jpg', width: 1920, height: 1080 },
      deps,
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: PHOTO_CAPTURE_MESSAGES.tooLarge }),
    });
    expect(deps.discard).toHaveBeenCalledTimes(3);
  });
});

describe('captureImage', () => {
  it('si el permiso se deniega devuelve un error de permiso', async () => {
    const denied = { granted: false, canAskAgain: false } as ImagePicker.CameraPermissionResponse;
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce(denied);

    const result = await captureImage('camera');

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: 'permission',
        message:
          'Se necesita permiso para continuar. Por favor actívalo en la configuración del dispositivo.',
      }),
    });
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('cancelar la galería no es un error', async () => {
    const result = await captureImage('library');

    expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: null });
  });
});
