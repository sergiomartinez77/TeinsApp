/**
 * @jest-environment ./jest.skia-environment.js
 */
import { AlphaType, ColorType, ImageFormat, Skia } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';

import type { RenderedImage } from '../services/photo-capture';
import { renderPhotoStamp } from '../services/photo-stamp-renderer';

/**
 * Prueba de humo del dibujado con Skia sobre CanvasKit (WebAssembly), el
 * simulador oficial de @shopify/react-native-skia. Comprueba que se decodifica
 * la imagen, se dibuja la franja oscura abajo, la parte de arriba queda intacta
 * y se exporta JPEG con la calidad pedida.
 *
 * Limitación: en CanvasKit no hay fuentes del sistema, así que el TEXTO no se
 * ve en esta prueba (la franja sí). La legibilidad del texto se revisa en un
 * dispositivo (docs/PRUEBAS_MANUALES.md).
 */

const WIDTH = 320;
const HEIGHT = 240;

/** PNG blanco de 320×240 generado con el propio CanvasKit. */
function whitePng(): Uint8Array {
  const surface = Skia.Surface.Make(WIDTH, HEIGHT);
  if (!surface) throw new Error('sin superficie');
  surface.getCanvas().drawColor(Skia.Color('#FFFFFF'));
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG);
}

function baseImage(): RenderedImage & { saves: number[] } {
  const saves: number[] = [];
  return {
    saves,
    width: WIDTH,
    height: HEIGHT,
    save: async (quality) => {
      saves.push(quality);
      const file = new File(Paths.cache, 'base-para-marca.png');
      await file.write(whitePng());
      return { uri: file.uri, width: WIDTH, height: HEIGHT };
    },
    release: jest.fn(),
  };
}

/** Brillo medio (0–255) de una fila de píxeles de la imagen JPEG. */
async function rowBrightness(uri: string, y: number): Promise<number> {
  const bytes = await new File(uri).bytes();
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!image) throw new Error('JPEG ilegible');
  const pixels = image.readPixels(0, y, {
    width: WIDTH,
    height: 1,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Opaque,
  });
  if (!pixels) throw new Error('sin píxeles');
  let total = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    total += (Number(pixels[x * 4]) + Number(pixels[x * 4 + 1]) + Number(pixels[x * 4 + 2])) / 3;
  }
  return total / WIDTH;
}

describe('renderPhotoStamp (Skia)', () => {
  it('dibuja la franja inferior semitransparente y exporta JPEG', async () => {
    const base = baseImage();

    const stamped = await renderPhotoStamp(base, [
      '18/11/2026 14:35:07',
      '-3.993421, -79.204512 ±8 m',
      'Revisión de la UPS principal del edificio administrativo',
    ]);

    // El archivo intermedio (calidad máxima) se guarda una vez y se borra.
    expect(base.saves).toEqual([1]);
    expect(stamped.width).toBe(WIDTH);
    expect(stamped.height).toBe(HEIGHT);

    const saved = await stamped.save(0.85);
    expect(saved).toMatchObject({ width: WIDTH, height: HEIGHT });
    const bytes = await new File(saved.uri).bytes();
    // Cabecera JPEG (FF D8).
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);

    expect(await rowBrightness(saved.uri, 5)).toBeGreaterThan(240);
    expect(await rowBrightness(saved.uri, HEIGHT - 3)).toBeLessThan(160);

    // Menor calidad → archivo más pequeño (sirve al reintento por 5 MB).
    const smaller = await stamped.save(0.5);
    expect((await new File(smaller.uri).bytes()).length).toBeLessThanOrEqual(bytes.length);
    stamped.release();
  });

  it('si la imagen no se puede leer, lanza (la captura la guarda sin marca)', async () => {
    const broken: RenderedImage = {
      width: 10,
      height: 10,
      save: async () => {
        const file = new File(Paths.cache, 'rota.jpg');
        await file.write('no es una imagen');
        return { uri: file.uri, width: 10, height: 10 };
      },
      release: jest.fn(),
    };
    await expect(renderPhotoStamp(broken, ['x'])).rejects.toThrow(
      'No se pudo leer la fotografía para imprimir la marca',
    );
  });
});
