import {
  ImageFormat,
  matchFont,
  Skia,
  type SkFont,
  type SkImage,
} from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { colors, withAlpha } from '@/theme';

import type { RenderedImage } from './photo-capture';
import { discardFile } from './photo-files';
import { fitText, stampLayout } from './photo-stamp';

/**
 * Dibuja la marca sobre la foto con Skia, fuera de pantalla:
 *
 *   imagen ya redimensionada → superficie offscreen → imagen + franja inferior
 *   semitransparente + texto blanco con sombra → JPEG con la calidad pedida.
 *
 * API de Skia 2.13 usada: `Skia.Data.fromBytes`, `Skia.Image.MakeImageFromEncoded`,
 * `Skia.Surface.MakeOffscreen` (GPU; si no hay, `Skia.Surface.Make`, en CPU),
 * `SkCanvas.drawImage` / `drawRect` / `drawText`, `matchFont`,
 * `SkSurface.makeImageSnapshot`, `SkImage.makeNonTextureImage` y
 * `SkImage.encodeToBytes(ImageFormat.JPEG, calidad)`.
 *
 * Este módulo importa Skia: solo lo carga la pantalla de fotos (los servicios
 * lo reciben inyectado), para no cargar Skia en los tests que no lo usan.
 */

/** Franja: el gris más oscuro de la paleta al 60 %: legible sobre fotos claras y oscuras. */
const BAND_COLOR = withAlpha(colors.grey900, 0.6);
const TEXT_COLOR = colors.textInverse;
const SHADOW_COLOR = withAlpha(colors.shadow, 0.85);
const FONT_FAMILY = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });

let fileCounter = 0;

/** Fuente del sistema en negrita; si el dispositivo no la ofrece, la predeterminada de Skia. */
function stampFont(fontSize: number): SkFont {
  try {
    return matchFont({ fontFamily: FONT_FAMILY, fontSize, fontWeight: 'bold' });
  } catch {
    return Skia.Font(undefined, fontSize);
  }
}

/** Ancho del texto en píxeles con la fuente indicada. */
const textWidth = (font: SkFont, text: string) => font.measureText(text).width;

async function decode(uri: string): Promise<SkImage> {
  const bytes = await new File(uri).bytes();
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) throw new Error('No se pudo leer la fotografía para imprimir la marca');
  return image;
}

/**
 * Devuelve una imagen nueva con la marca dibujada. `base` debe ser la imagen
 * ya redimensionada; se guarda una vez con calidad máxima para pasársela a
 * Skia y ese archivo intermedio se borra enseguida.
 */
export async function renderPhotoStamp(
  base: RenderedImage,
  lines: readonly string[],
): Promise<RenderedImage> {
  const intermediate = await base.save(1);
  let source: SkImage;
  try {
    source = await decode(intermediate.uri);
  } finally {
    discardFile(intermediate.uri);
  }

  const width = source.width();
  const height = source.height();
  const surface = Skia.Surface.MakeOffscreen(width, height) ?? Skia.Surface.Make(width, height);
  if (!surface) {
    source.dispose();
    throw new Error('No se pudo crear la superficie para imprimir la marca');
  }

  const layout = stampLayout(width, height, lines.length);
  const font = stampFont(layout.fontSize);
  const metrics = font.getMetrics();
  const ascent = Math.abs(metrics.ascent) || layout.fontSize * 0.8;
  const descent = Math.abs(metrics.descent) || layout.fontSize * 0.2;
  const shadowOffset = Math.max(1, Math.round(layout.fontSize / 16));

  const canvas = surface.getCanvas();
  canvas.drawImage(source, 0, 0);

  const band = Skia.Paint();
  band.setColor(Skia.Color(BAND_COLOR));
  const bandTop = height - layout.bandHeight;
  canvas.drawRect(Skia.XYWHRect(0, bandTop, width, layout.bandHeight), band);

  const text = Skia.Paint();
  text.setColor(Skia.Color(TEXT_COLOR));
  text.setAntiAlias(true);
  const shadow = Skia.Paint();
  shadow.setColor(Skia.Color(SHADOW_COLOR));
  shadow.setAntiAlias(true);

  lines.forEach((line, index) => {
    const fitted = fitText(line, layout.maxTextWidth, (value) => textWidth(font, value));
    const lineTop = bandTop + layout.padding + layout.lineHeight * index;
    const baseline = lineTop + (layout.lineHeight - (ascent + descent)) / 2 + ascent;
    canvas.drawText(fitted, layout.padding + shadowOffset, baseline + shadowOffset, shadow, font);
    canvas.drawText(fitted, layout.padding, baseline, text, font);
  });

  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  // Copia en memoria de CPU: se puede codificar y liberar la superficie de GPU.
  const stamped = snapshot.makeNonTextureImage() ?? snapshot;
  if (stamped !== snapshot) snapshot.dispose();
  source.dispose();
  surface.dispose();

  return {
    width,
    height,
    save: async (quality) => {
      const bytes = stamped.encodeToBytes(ImageFormat.JPEG, Math.round(quality * 100));
      if (bytes.length === 0) throw new Error('No se pudo codificar la fotografía con la marca');
      fileCounter += 1;
      const file = new File(Paths.cache, `teins_marca_${Date.now()}_${fileCounter}.jpg`);
      await file.write(bytes);
      return { uri: file.uri, width, height };
    },
    release: () => stamped.dispose(),
  };
}
