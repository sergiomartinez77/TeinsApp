import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { targetImageSize, type ImageBounds } from '@/features/photos/services/image-size';
import { discardFile } from '@/features/photos/services/photo-files';
import type { VisitPhoto } from '@/models/photo.model';

import type { ReportPhotoReader } from './visit-report.data';

/**
 * Fotos del informe: se leen del dispositivo (ya llevan impresa la marca de
 * fecha, hora y ubicación) y se reducen antes de incrustarlas en el PDF para
 * que el archivo se pueda enviar por WhatsApp o correo.
 */

/** Tamaño máximo de las fotos en el PDF (sobra para media página A4). */
export const REPORT_IMAGE_BOUNDS: ImageBounds = { maxLong: 1280, maxShort: 960 };

/** Calidad JPEG de las fotos en el PDF. */
export const REPORT_IMAGE_QUALITY = 0.6;

const sameSize = (a: { width: number; height: number }, b: { width: number; height: number }) =>
  a.width === b.width && a.height === b.height;

/** Decodifica la foto, la reduce si hace falta y la devuelve en base64 (JPEG). */
async function shrinkToBase64(uri: string, photo: VisitPhoto): Promise<string> {
  const render = async (size: { width: number; height: number } | null) => {
    const context = ImageManipulator.manipulate(uri);
    try {
      if (size) context.resize(size);
      return await context.renderAsync();
    } finally {
      context.release();
    }
  };

  const known =
    photo.width !== null && photo.height !== null && photo.width > 0 && photo.height > 0
      ? { width: photo.width, height: photo.height }
      : null;
  const planned = known ? targetImageSize(known, REPORT_IMAGE_BOUNDS) : null;

  let image = await render(planned && known && !sameSize(planned, known) ? planned : null);
  try {
    // Sin tamaño guardado: se mide con la imagen ya decodificada.
    if (!known) {
      const target = targetImageSize(image, REPORT_IMAGE_BOUNDS);
      if (!sameSize(target, image)) {
        image.release();
        image = await render(target);
      }
    }
    const saved = await image.saveAsync({
      compress: REPORT_IMAGE_QUALITY,
      format: SaveFormat.JPEG,
      base64: true,
    });
    discardFile(saved.uri);
    if (!saved.base64) throw new Error('La imagen reducida no trae datos en base64');
    return saved.base64;
  } finally {
    image.release();
  }
}

/** Lector real: archivo en `Paths.document/<local_path>` reducido con expo-image-manipulator. */
export const deviceReportPhotoReader: ReportPhotoReader = {
  read: async (photo) => {
    if (!photo.localPath) return null;
    const file = new File(Paths.document, photo.localPath);
    if (!file.exists) return null;
    const base64 = await shrinkToBase64(file.uri, photo);
    return `data:image/jpeg;base64,${base64}`;
  },
};
