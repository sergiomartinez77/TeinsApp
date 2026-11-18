import { File, Paths } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  captureImage,
  compressImage,
  type CompressionDeps,
  type RenderedImage,
  type StampLocator,
} from '../services/photo-capture';

/**
 * Marca impresa en la captura: de dónde salen fecha y ubicación, que la marca
 * se dibuja DESPUÉS de redimensionar y ANTES de comprimir (respetando el
 * reintento por 5 MB), y que nunca se pierde la foto por la ubicación o por
 * la marca. El dibujado real con Skia se prueba en photo-stamp-renderer.test.ts.
 */

jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const MB = 1024 * 1024;
const NOW = new Date(2026, 10, 18, 14, 35, 7);
const LOJA = { latitude: -3.993421, longitude: -79.204512, accuracy: 8 };

function picked(source: 'camera' | 'library', width: number, height: number, exif?: object) {
  const file = new File(Paths.cache, `elegida-${source}-${width}.jpg`);
  file.write('original');
  const launch =
    source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  jest.mocked(launch).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: file.uri, width, height, exif } as ImagePicker.ImagePickerAsset],
  });
}

/** Manipulador simulado: cada guardado escribe un JPEG pequeño en la caché. */
function fakeManipulator() {
  const resize = jest.fn();
  let saved = 0;
  jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
    const size = { width: 4000, height: 3000 };
    const context: Record<string, unknown> = {
      resize: jest.fn((target: { width: number; height: number }): unknown => {
        resize(target);
        Object.assign(size, target);
        return context;
      }),
      renderAsync: async () => ({
        ...size,
        saveAsync: async () => {
          saved += 1;
          const output = new File(Paths.cache, `manipulada-${saved}.jpg`);
          output.write('x'.repeat(100));
          return { uri: output.uri, width: size.width, height: size.height };
        },
        release: jest.fn(),
      }),
      release: jest.fn(),
    };
    return context as unknown as ReturnType<typeof ImageManipulator.manipulate>;
  });
  return { resize };
}

/** Renderizador falso: anota las líneas y el tamaño recibido y escribe la imagen "marcada". */
function fakeRenderer() {
  const calls: { lines: readonly string[]; width: number; height: number }[] = [];
  const render = jest.fn(async (image: RenderedImage, lines: readonly string[]) => {
    calls.push({ lines, width: image.width, height: image.height });
    const marked: RenderedImage = {
      width: image.width,
      height: image.height,
      save: async () => {
        const output = new File(Paths.cache, 'marcada.jpg');
        output.write('marcada');
        return { uri: output.uri, width: image.width, height: image.height };
      },
      release: jest.fn(),
    };
    return marked;
  });
  return { render, calls };
}

const locator = (granted: boolean, location = LOJA): StampLocator & { current: jest.Mock } => ({
  requestPermission: jest.fn(async () => granted),
  current: jest.fn(async () => location),
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('captureImage con marca', () => {
  it('cámara: hora actual y posición del dispositivo, dibujada sobre la imagen ya redimensionada', async () => {
    picked('camera', 4000, 3000);
    const { resize } = fakeManipulator();
    const { render, calls } = fakeRenderer();
    const gps = locator(true);

    const result = await captureImage('camera', {
      stamp: { visitTitle: 'Revisión UPS', render, locator: gps, now: () => NOW },
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('sin imagen');
    expect(resize).toHaveBeenCalledWith({ width: 1440, height: 1080 });
    expect(calls).toEqual([
      {
        lines: ['18/11/2026 14:35:07', '-3.993421, -79.204512 ±8 m', 'Revisión UPS'],
        width: 1440,
        height: 1080,
      },
    ]);
    expect(result.data.uri).toContain('marcada.jpg');
    expect(result.data.stamp).toEqual({ takenAt: NOW.toISOString(), location: LOJA });
    // El EXIF no se pide para la cámara.
    expect(jest.mocked(ImagePicker.launchCameraAsync).mock.calls[0]?.[0]).toMatchObject({
      exif: false,
    });
  });

  it('cámara con permiso de ubicación denegado: la foto se guarda con "Ubicación no disponible"', async () => {
    picked('camera', 800, 600);
    fakeManipulator();
    const { render, calls } = fakeRenderer();
    const gps = locator(false);

    const result = await captureImage('camera', {
      stamp: { visitTitle: '', render, locator: gps, now: () => NOW },
    });

    expect(result.ok && result.data?.stamp).toEqual({ takenAt: NOW.toISOString(), location: null });
    expect(calls[0]?.lines).toEqual(['18/11/2026 14:35:07', 'Ubicación no disponible']);
    expect(gps.current).not.toHaveBeenCalled();
  });

  it('galería: fecha y ubicación del EXIF; nunca pide la posición actual', async () => {
    picked('library', 800, 600, {
      DateTimeOriginal: '2026:10:01 08:00:00',
      GPSLatitude: -3.993421,
      GPSLongitude: -79.204512,
    });
    fakeManipulator();
    const { render, calls } = fakeRenderer();
    const gps = locator(true);

    const result = await captureImage('library', {
      stamp: { visitTitle: 'Bodega', render, locator: gps, now: () => NOW },
    });

    expect(result.ok && result.data?.stamp).toEqual({
      takenAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
      location: { ...LOJA, accuracy: null },
    });
    expect(calls[0]?.lines[0]).toBe('01/10/2026 08:00:00');
    expect(gps.requestPermission).not.toHaveBeenCalled();
    expect(gps.current).not.toHaveBeenCalled();
    expect(jest.mocked(ImagePicker.launchImageLibraryAsync).mock.calls[0]?.[0]).toMatchObject({
      exif: true,
    });
  });

  it('galería sin EXIF: fecha actual y sin ubicación', async () => {
    picked('library', 800, 600);
    fakeManipulator();
    const { render } = fakeRenderer();

    const result = await captureImage('library', {
      stamp: { visitTitle: 'Bodega', render, locator: locator(true), now: () => NOW },
    });

    expect(result.ok && result.data?.stamp).toEqual({ takenAt: NOW.toISOString(), location: null });
  });

  it('sin marca pedida, la foto no lleva datos de marca', async () => {
    picked('camera', 800, 600);
    fakeManipulator();
    const result = await captureImage('camera');
    expect(result.ok && result.data?.stamp).toBeNull();
  });
});

describe('compressImage con marca', () => {
  function deps(sizeForQuality: (quality: number) => number, stamp: CompressionDeps['stamp']) {
    const sizes = new Map<string, number>();
    const base: RenderedImage = {
      width: 1920,
      height: 1080,
      save: async (quality) => {
        const uri = `file:///cache/base-${quality}.jpg`;
        sizes.set(uri, sizeForQuality(quality));
        return { uri, width: 1920, height: 1080 };
      },
      release: jest.fn(),
    };
    const value: CompressionDeps & { discard: jest.Mock } = {
      render: async () => base,
      fileSize: (uri) => sizes.get(uri) ?? 0,
      discard: jest.fn(),
      stamp,
    };
    return { value, base, sizes };
  }

  it('la imagen marcada respeta el reintento de calidad por 5 MB y se libera', async () => {
    const qualities: number[] = [];
    const sizes = new Map<string, number>();
    const marked: RenderedImage = {
      width: 1920,
      height: 1080,
      save: async (quality) => {
        qualities.push(quality);
        const uri = `file:///cache/marcada-${quality}.jpg`;
        sizes.set(uri, quality > 0.5 ? 6 * MB : 3 * MB);
        return { uri, width: 1920, height: 1080 };
      },
      release: jest.fn(),
    };
    const { value, base } = deps(
      () => MB,
      async () => marked,
    );
    value.fileSize = (uri) => sizes.get(uri) ?? 0;

    const result = await compressImage({ uri: 'file:///x.jpg', width: 1920, height: 1080 }, value);

    expect(qualities).toEqual([0.85, 0.7, 0.5]);
    expect(result.ok && result.data.uri).toBe('file:///cache/marcada-0.5.jpg');
    expect(marked.release).toHaveBeenCalled();
    expect(base.release).toHaveBeenCalled();
  });

  it('si la marca falla, la foto se guarda igual sin ella', async () => {
    const { value } = deps(
      () => MB,
      async () => {
        throw new Error('Skia no disponible');
      },
    );
    const result = await compressImage({ uri: 'file:///x.jpg', width: 1920, height: 1080 }, value);
    expect(result.ok && result.data.uri).toBe('file:///cache/base-0.85.jpg');
  });
});
