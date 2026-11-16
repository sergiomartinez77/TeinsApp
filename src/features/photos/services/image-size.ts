import { PHOTOS } from '@/constants/app.constants';

/**
 * Cálculo puro del tamaño final de una fotografía (sin dependencias nativas).
 */

export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageBounds {
  /** Lado largo máximo (1920). */
  maxLong: number;
  /** Lado corto máximo (1080). */
  maxShort: number;
}

export const DEFAULT_IMAGE_BOUNDS: ImageBounds = {
  maxLong: PHOTOS.maxWidth,
  maxShort: PHOTOS.maxHeight,
};

/**
 * Tamaño destino manteniendo la proporción:
 * - Horizontal (o cuadrada): cabe en 1920 × 1080.
 * - Vertical: cabe en 1080 × 1920.
 * Nunca se amplía una imagen pequeña. Devuelve enteros de al menos 1 px.
 */
export function targetImageSize(
  source: ImageSize,
  bounds: ImageBounds = DEFAULT_IMAGE_BOUNDS,
): ImageSize {
  const { width, height } = source;
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };

  const landscape = width >= height;
  const boxWidth = landscape ? bounds.maxLong : bounds.maxShort;
  const boxHeight = landscape ? bounds.maxShort : bounds.maxLong;
  const scale = Math.min(1, boxWidth / width, boxHeight / height);

  if (scale === 1) return { width: Math.round(width), height: Math.round(height) };
  return {
    width: Math.max(1, Math.min(boxWidth, Math.round(width * scale))),
    height: Math.max(1, Math.min(boxHeight, Math.round(height * scale))),
  };
}

/** Si hace falta redimensionar para respetar los límites. */
export function needsResize(
  source: ImageSize,
  bounds: ImageBounds = DEFAULT_IMAGE_BOUNDS,
): boolean {
  const target = targetImageSize(source, bounds);
  return target.width > 0 && (target.width !== source.width || target.height !== source.height);
}
