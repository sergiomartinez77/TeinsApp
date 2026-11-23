import { Skia, type SkPath } from '@shopify/react-native-skia';

/**
 * Cuadrícula del plano calculada en el hilo de la interfaz (worklets): así
 * se mueve con el pellizco y el arrastre sin pasar por JavaScript.
 * Coordenadas en píxeles de pantalla; las líneas siempre miden 1 px.
 */

/** Mismos pasos que `GRID_STEPS_CM` (copiados: un worklet solo captura valores simples). */
const STEPS = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000];
const MIN_SPACING_PX = 14;

/** Paso de la cuadrícula fina (`level` 0) o marcada (`level` 1) para la escala. */
export function gridStepFor(scale: number, level: 0 | 1): number {
  'worklet';
  let index = STEPS.length - 1;
  for (let i = 0; i < STEPS.length; i += 1) {
    const step = STEPS[i] ?? 1;
    if (step * scale >= MIN_SPACING_PX) {
      index = i;
      break;
    }
  }
  const minor = STEPS[index] ?? 1;
  if (level === 0) return minor;
  return STEPS[index + 1] ?? minor * 10;
}

/** Líneas verticales y horizontales cada `step` cm visibles en un área de `width` × `height`. */
export function gridLinesPath(
  scale: number,
  tx: number,
  ty: number,
  width: number,
  height: number,
  step: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const spacing = step * scale;
  if (!(spacing >= 4) || width <= 0 || height <= 0) return path;
  const startX = ((tx % spacing) + spacing) % spacing;
  const startY = ((ty % spacing) + spacing) % spacing;
  for (let x = startX; x <= width; x += spacing) {
    path.moveTo(x, 0);
    path.lineTo(x, height);
  }
  for (let y = startY; y <= height; y += spacing) {
    path.moveTo(0, y);
    path.lineTo(width, y);
  }
  return path;
}
