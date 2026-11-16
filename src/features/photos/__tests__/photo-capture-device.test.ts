import { File, Paths } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { captureImage, PHOTO_CAPTURE_MESSAGES } from '../services/photo-capture';

/**
 * `captureImage` con la compresión real del dispositivo (`deviceCompression`)
 * sobre un manipulador de imágenes simulado y el sistema de archivos en
 * memoria de jest-expo. La calidad visual del JPEG se revisa a mano.
 */

jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

/** Foto que entrega la cámara: un archivo temporal en la caché. */
function pickedPhoto(name: string, width: number, height: number) {
  const file = new File(Paths.cache, name);
  file.write('original');
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: file.uri, width, height } as ImagePicker.ImagePickerAsset],
  });
  return file;
}

/** Manipulador simulado: guarda un JPEG de `bytes` bytes en la caché. */
function fakeManipulator(decoded: { width: number; height: number }, bytes = 2048) {
  const resize = jest.fn();
  let saved = 0;
  jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
    const size = { ...decoded };
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
          const output = new File(Paths.cache, `salida-${saved}.jpg`);
          output.write('x'.repeat(bytes));
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe('captureImage con compresión del dispositivo', () => {
  it('redimensiona a 1920×1080 como máximo, comprime y borra el original temporal', async () => {
    const original = pickedPhoto('camara-1.jpg', 4000, 3000);
    const { resize } = fakeManipulator({ width: 4000, height: 3000 });

    const result = await captureImage('camera');

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('sin imagen');
    expect(result.data).toMatchObject({ width: 1440, height: 1080, sizeBytes: 2048 });
    expect(resize).toHaveBeenCalledWith({ width: 1440, height: 1080 });
    expect(original.exists).toBe(false);
  });

  it('si el selector no informa el tamaño lo calcula con la imagen decodificada', async () => {
    pickedPhoto('camara-2.jpg', 0, 0);
    const { resize } = fakeManipulator({ width: 3840, height: 2160 });

    const result = await captureImage('camera');

    expect(result.ok && result.data).toMatchObject({ width: 1920, height: 1080 });
    expect(resize).toHaveBeenCalledWith({ width: 1920, height: 1080 });
  });

  it('si el manipulador falla devuelve un error y aun así borra el original', async () => {
    const original = pickedPhoto('camara-3.jpg', 800, 600);
    jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
      throw new Error('formato no admitido');
    });

    const result = await captureImage('camera');

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'storage', message: PHOTO_CAPTURE_MESSAGES.failed },
    });
    expect(original.exists).toBe(false);
  });

  it('si el selector falla devuelve un error de almacenamiento', async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockRejectedValueOnce(new Error('sin galería'));

    const result = await captureImage('library');

    expect(result).toMatchObject({ ok: false, error: { message: PHOTO_CAPTURE_MESSAGES.failed } });
  });
});
