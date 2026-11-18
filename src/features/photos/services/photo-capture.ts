import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { PHOTOS } from '@/constants/app.constants';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';

import { targetImageSize, type ImageSize } from './image-size';
import { discardFile, fileSizeAt } from './photo-files';
import { currentPhotoLocation, requestPhotoLocationPermission } from './photo-location';
import {
  buildStampLines,
  resolveStampData,
  type PhotoLocation,
  type PhotoStampData,
} from './photo-stamp';

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
  /**
   * Dibuja la marca (fecha, ubicación y visita) sobre la imagen YA redimensionada
   * y devuelve la imagen marcada, que es la que se comprime y guarda.
   */
  stamp?: (image: RenderedImage) => Promise<RenderedImage>;
  maxBytes?: number;
}

/**
 * Redimensiona (sin ampliar), imprime la marca si se pidió y guarda en JPEG
 * 0,85. Si el archivo supera 5 MB, reintenta con 0,7 y 0,5; si aún supera,
 * devuelve un error.
 *
 * Si la marca no se puede dibujar, la foto se guarda igual sin ella (sus datos
 * se guardan en la fila): nunca se pierde una foto por culpa de la marca.
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
  let stamped: RenderedImage | null = null;
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

    if (deps.stamp) {
      try {
        stamped = await deps.stamp(rendered);
      } catch (error) {
        log.warn('No se pudo imprimir la marca; la foto se guarda sin ella', error);
      }
    }
    const output = stamped ?? rendered;

    for (const quality of JPEG_QUALITIES) {
      const saved = await output.save(quality);
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
    stamped?.release();
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

// ── Marca impresa ────────────────────────────────────────────────────────────

/** Dibuja las líneas de la marca sobre una imagen (Skia en el dispositivo). */
export type StampRenderer = (
  image: RenderedImage,
  lines: readonly string[],
) => Promise<RenderedImage>;

/** Ubicación del dispositivo (inyectable en tests). */
export interface StampLocator {
  /** Pide el permiso "mientras se usa la app"; `false` si se deniega. Nunca lanza. */
  requestPermission: () => Promise<boolean>;
  /** Posición actual o `null` (sin GPS, sin señal o más de 8 s). Nunca lanza. */
  current: () => Promise<PhotoLocation | null>;
}

const deviceLocator: StampLocator = {
  requestPermission: () => requestPhotoLocationPermission(),
  current: () => currentPhotoLocation(),
};

export interface CaptureStampOptions {
  /** Título de la visita (se recorta si no cabe). */
  visitTitle: string;
  render: StampRenderer;
  locator?: StampLocator;
  now?: () => Date;
}

export interface CaptureOptions {
  /** Si se indica, se imprime la marca sobre la foto. */
  stamp?: CaptureStampOptions;
}

/** Foto lista para guardarse, con los datos que se imprimieron en ella. */
export interface CapturedImage extends CompressedImage {
  /** `null` (o ausente) si no se pidió marca. */
  stamp?: PhotoStampData | null;
}

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
 * cámara o la galería, imprime la marca (si se pide) y comprime la imagen.
 *
 * Marca:
 * - Cámara: el permiso de ubicación se pide aquí, antes de abrir la cámara
 *   (el sistema solo pregunta la primera vez). Se usa la posición actual del
 *   dispositivo; si se deniega o el GPS no responde, "Ubicación no disponible".
 * - Galería: fecha y ubicación del EXIF de la foto; sin EXIF, la fecha actual y
 *   "Ubicación no disponible" (nunca la posición actual: no sería la de la foto).
 *
 * Devuelve `null` si el técnico canceló (no es un error). Un permiso de cámara
 * o galería denegado vuelve como error de tipo `permission`; el de ubicación
 * nunca impide la foto.
 */
export async function captureImage(
  source: PhotoSource,
  captureOptions: CaptureOptions = {},
): Promise<Result<CapturedImage | null>> {
  let pickedUri: string | null = null;
  const stampOptions = captureOptions.stamp;
  const locator = stampOptions?.locator ?? deviceLocator;
  try {
    if (!(await requestPermission(source))) return err(appError('permission'));
    const locationGranted =
      stampOptions && source === 'camera' ? await locator.requestPermission() : false;

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      allowsEditing: false,
      allowsMultipleSelection: false,
      // Se recibe sin pérdida: la compresión se hace después, una sola vez.
      quality: 1,
      // El EXIF solo hace falta para la fecha y la ubicación de las fotos de galería.
      exif: Boolean(stampOptions) && source === 'library',
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return ok(null);
    pickedUri = asset.uri;

    if (!stampOptions) {
      const compressed = await compressImage(asset, deviceCompression);
      return compressed.ok ? ok({ ...compressed.data, stamp: null }) : compressed;
    }

    const now = (stampOptions.now ?? (() => new Date()))();
    const deviceLocation = locationGranted ? await locator.current() : null;
    const stamp = resolveStampData({ source, now, exif: asset.exif, deviceLocation });
    const lines = buildStampLines(stamp, stampOptions.visitTitle);
    const compressed = await compressImage(asset, {
      ...deviceCompression,
      stamp: (image) => stampOptions.render(image, lines),
    });
    return compressed.ok ? ok({ ...compressed.data, stamp }) : compressed;
  } catch (error) {
    log.error('No se pudo obtener la fotografía', error);
    return err(appError('storage', { message: PHOTO_CAPTURE_MESSAGES.failed, cause: error }));
  } finally {
    // La copia temporal que entrega el selector ya no se necesita.
    if (pickedUri) discardFile(pickedUri);
  }
}
