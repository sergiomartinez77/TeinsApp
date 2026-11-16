import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { PHOTOS } from '@/constants/app.constants';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';

import { targetImageSize, type ImageSize } from './image-size';
import { discardFile, fileSizeAt } from './photo-files';

const log = scopedLogger('photos');

/** Origen de la fotografía. */
export type PhotoSource = 'camera' | 'library';

export const PHOTO_CAPTURE_MESSAGES = {
  tooLarge: 'La fotografía es demasiado grande. Intenta tomarla de nuevo.',
  failed: 'No se pudo procesar la fotografía. Intenta nuevamente.',
} as const;

/** Calidades JPEG que se prueban en orden hasta que el archivo quepa en 5 MB. */
export const JPEG_QUALITIES: readonly number[] = [PHOTOS.jpegQuality, 0.7, 0.5];

/** JPEG ya comprimido, en un archivo temporal, listo para guardarse. */
export interface CompressedImage {
  uri: string;
  width: number;
  height: number;
  sizeBytes: number;
}

// ── Compresión (con dependencias inyectables) ────────────────────────────────

/** Imagen ya decodificada y redimensionada, que se puede guardar varias veces. */
export interface RenderedImage {
  width: number;
  height: number;
  save: (quality: number) => Promise<{ uri: string; width: number; height: number }>;
  release: () => void;
}

export interface CompressionDeps {
  /** Decodifica la imagen y la redimensiona a `size` (o la deja igual si es `null`). */
  render: (uri: string, size: ImageSize | null) => Promise<RenderedImage>;
  fileSize: (uri: string) => number;
  discard: (uri: string) => void;
  maxBytes?: number;
}

/**
 * Redimensiona (sin ampliar) y guarda en JPEG 0,85. Si el archivo supera
 * 5 MB, reintenta con 0,7 y 0,5; si aún supera, devuelve un error.
 */
export async function compressImage(
  source: { uri: string; width: number; height: number },
  deps: CompressionDeps,
): Promise<Result<CompressedImage>> {
  const maxBytes = deps.maxBytes ?? PHOTOS.maxBytes;
  const known = source.width > 0 && source.height > 0;
  const target = known ? targetImageSize(source) : null;
  const resize =
    target && (target.width !== source.width || target.height !== source.height) ? target : null;

  let rendered: RenderedImage | null = null;
  try {
    rendered = await deps.render(source.uri, resize);
    // Si el selector no informó el tamaño, se calcula con la imagen ya decodificada.
    if (!known) {
      const size = targetImageSize({ width: rendered.width, height: rendered.height });
      if (size.width !== rendered.width || size.height !== rendered.height) {
        rendered.release();
        rendered = await deps.render(source.uri, size);
      }
    }

    for (const quality of JPEG_QUALITIES) {
      const saved = await rendered.save(quality);
      const sizeBytes = deps.fileSize(saved.uri);
      if (sizeBytes > 0 && sizeBytes <= maxBytes) {
        return ok({ uri: saved.uri, width: saved.width, height: saved.height, sizeBytes });
      }
      deps.discard(saved.uri);
    }
    return err(validationError(PHOTO_CAPTURE_MESSAGES.tooLarge, 'photo_too_large'));
  } catch (error) {
    log.error('No se pudo comprimir la fotografía', error);
    return err(appError('storage', { message: PHOTO_CAPTURE_MESSAGES.failed, cause: error }));
  } finally {
    rendered?.release();
  }
}

/** Compresión con expo-image-manipulator (API contextual de SDK 52+). */
const deviceCompression: CompressionDeps = {
  render: async (uri, size) => {
    const context = ImageManipulator.manipulate(uri);
    if (size) context.resize({ width: size.width, height: size.height });
    const image = await context.renderAsync();
    context.release();
    return {
      width: image.width,
      height: image.height,
      save: (quality) => image.saveAsync({ compress: quality, format: SaveFormat.JPEG }),
      release: () => image.release(),
    };
  },
  fileSize: fileSizeAt,
  discard: discardFile,
};

// ── Permisos y selector ──────────────────────────────────────────────────────

async function requestPermission(source: PhotoSource): Promise<boolean> {
  const response =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  return response.granted;
}

/**
 * Pide el permiso de la fuente elegida (en el momento de usarla), abre la
 * cámara o la galería y comprime la imagen.
 *
 * Devuelve `null` si el técnico canceló (no es un error). Un permiso denegado
 * vuelve como error de tipo `permission`.
 */
export async function captureImage(source: PhotoSource): Promise<Result<CompressedImage | null>> {
  let pickedUri: string | null = null;
  try {
    if (!(await requestPermission(source))) return err(appError('permission'));

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      allowsEditing: false,
      allowsMultipleSelection: false,
      // Se recibe sin pérdida: la compresión se hace después, una sola vez.
      quality: 1,
      exif: false,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return ok(null);
    pickedUri = asset.uri;

    return await compressImage(asset, deviceCompression);
  } catch (error) {
    log.error('No se pudo obtener la fotografía', error);
    return err(appError('storage', { message: PHOTO_CAPTURE_MESSAGES.failed, cause: error }));
  } finally {
    // La copia temporal que entrega el selector ya no se necesita.
    if (pickedUri) discardFile(pickedUri);
  }
}
