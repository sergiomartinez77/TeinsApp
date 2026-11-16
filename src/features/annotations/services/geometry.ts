import { argbToCss, type AnnotationElement, type CanvasPoint } from '@/models/annotation.model';

import { DRAWING_THRESHOLDS } from '../constants';

/**
 * Geometría del dibujo, sin dependencias nativas: el canvas convierte las
 * cadenas de trazado SVG con Skia y aquí se prueban sin él.
 *
 * Unidades: los elementos guardan puntos normalizados (0–1); los cálculos
 * de dibujo y de toque se hacen en píxeles del canvas actual.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Punto en píxeles del canvas. */
export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasFrame extends Size {
  /** Desplazamiento para centrar el canvas dentro del área (franjas alrededor). */
  readonly offsetX: number;
  readonly offsetY: number;
}

const isValidSize = (size: Size | null | undefined): size is Size =>
  Boolean(size && size.width > 0 && size.height > 0);

/**
 * Canvas lo más grande posible dentro del área con la proporción de la
 * referencia, centrado. Sin referencia ocupa toda el área.
 */
export function fitCanvas(area: Size, reference: Size | null): CanvasFrame {
  if (!isValidSize(area)) return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  if (!isValidSize(reference)) {
    return { width: area.width, height: area.height, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(area.width / reference.width, area.height / reference.height);
  const width = reference.width * scale;
  const height = reference.height * scale;
  return {
    width,
    height,
    offsetX: (area.width - width) / 2,
    offsetY: (area.height - height) / 2,
  };
}

/** Factor para los grosores y tamaños guardados: ancho actual / ancho de referencia. */
export function strokeScale(canvasWidth: number, referenceWidth: number | null): number {
  if (!referenceWidth || referenceWidth <= 0 || canvasWidth <= 0) return 1;
  return canvasWidth / referenceWidth;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Píxeles del canvas → coordenadas normalizadas (recortadas a 0–1). */
export function normalizePoint(point: PixelPoint, size: Size): CanvasPoint {
  if (!isValidSize(size)) return { x: 0, y: 0 };
  return { x: clamp01(point.x / size.width), y: clamp01(point.y / size.height) };
}

/** Coordenadas normalizadas → píxeles del canvas. */
export function denormalizePoint(point: CanvasPoint, size: Size): PixelPoint {
  return { x: point.x * size.width, y: point.y * size.height };
}

export function distance(a: PixelPoint, b: PixelPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Añade un punto al trazo salvo que esté demasiado cerca del anterior. */
export function appendPoint(
  points: readonly PixelPoint[],
  point: PixelPoint,
  minDistance: number = DRAWING_THRESHOLDS.minPointDistancePx,
): readonly PixelPoint[] {
  const last = points[points.length - 1];
  if (last && distance(last, point) < minDistance) return points;
  return [...points, point];
}

// ── Trazados SVG ─────────────────────────────────────────────────────────────

const num = (value: number) => String(Math.round(value * 100) / 100);
const pair = (point: PixelPoint) => `${num(point.x)} ${num(point.y)}`;

/**
 * Trazo libre suavizado: curvas cuadráticas que pasan por los puntos medios
 * y usan cada punto como control. Un solo punto dibuja un punto.
 */
export function freeStrokePath(points: readonly PixelPoint[]): string {
  const [first, second] = points;
  if (!first) return '';
  if (!second) return `M ${pair(first)} L ${pair({ x: first.x + 0.01, y: first.y })}`;
  if (points.length === 2) return `M ${pair(first)} L ${pair(second)}`;

  let path = `M ${pair(first)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index];
    const next = points[index + 1];
    if (!control || !next) continue;
    const mid = { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    path += ` Q ${pair(control)} ${pair(mid)}`;
  }
  const last = points[points.length - 1];
  return last ? `${path} L ${pair(last)}` : path;
}

export function linePath(start: PixelPoint, end: PixelPoint): string {
  return `M ${pair(start)} L ${pair(end)}`;
}

/** Longitud mínima de la punta de flecha en píxeles. */
const ARROW_MIN_HEAD_PX = 12;
const ARROW_HEAD_ANGLE = Math.PI / 6;

/** Extremos de las dos alas de la punta, que nacen en `end`. */
export function arrowHead(
  start: PixelPoint,
  end: PixelPoint,
  strokeWidthPx: number,
): [PixelPoint, PixelPoint] {
  const length = Math.max(ARROW_MIN_HEAD_PX, strokeWidthPx * 4);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const wing = (offset: number): PixelPoint => ({
    x: end.x - length * Math.cos(angle + offset),
    y: end.y - length * Math.sin(angle + offset),
  });
  return [wing(-ARROW_HEAD_ANGLE), wing(ARROW_HEAD_ANGLE)];
}

/** Línea con punta en el extremo final. */
export function arrowPath(start: PixelPoint, end: PixelPoint, strokeWidthPx: number): string {
  const [left, right] = arrowHead(start, end, strokeWidthPx);
  return `${linePath(start, end)} M ${pair(left)} L ${pair(end)} L ${pair(right)}`;
}

/** Rectángulo definido por dos esquinas opuestas. */
export function rectanglePath(a: PixelPoint, b: PixelPoint): string {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return `M ${pair({ x: left, y: top })} L ${pair({ x: right, y: top })} L ${pair({
    x: right,
    y: bottom,
  })} L ${pair({ x: left, y: bottom })} Z`;
}

export interface CircleGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** Círculo: el primer punto es el centro y el segundo un punto del borde. */
export function circleGeometry(center: PixelPoint, edge: PixelPoint): CircleGeometry {
  return { cx: center.x, cy: center.y, r: distance(center, edge) };
}

/** Círculo como dos semicircunferencias. */
export function circlePath(center: PixelPoint, edge: PixelPoint): string {
  const { cx, cy, r } = circleGeometry(center, edge);
  const radius = num(r);
  return `M ${num(cx - r)} ${num(cy)} A ${radius} ${radius} 0 1 0 ${num(cx + r)} ${num(
    cy,
  )} A ${radius} ${radius} 0 1 0 ${num(cx - r)} ${num(cy)} Z`;
}

/** Líneas de la cuadrícula del lienzo: `columns` celdas cuadradas a lo ancho. */
export function gridPath(size: Size, columns: number): string {
  if (!isValidSize(size) || columns <= 0) return '';
  const cell = size.width / columns;
  const segments: string[] = [];
  for (let x = cell; x < size.width - 0.5; x += cell) {
    segments.push(`M ${num(x)} 0 L ${num(x)} ${num(size.height)}`);
  }
  for (let y = cell; y < size.height - 0.5; y += cell) {
    segments.push(`M 0 ${num(y)} L ${num(size.width)} ${num(y)}`);
  }
  return segments.join(' ');
}

// ── Datos de dibujo por elemento ─────────────────────────────────────────────

/** Radio del marcador (en unidades de la referencia) según el grosor elegido. */
export function markerRadius(strokeWidth: number): number {
  return 4 + strokeWidth * 1.5;
}

/** Ancho aproximado de un carácter respecto al tamaño de letra (para tocar texto). */
const CHAR_WIDTH_RATIO = 0.55;
const DEFAULT_FONT_SIZE = 18;

export type ElementDrawing =
  | {
      readonly kind: 'stroke';
      readonly path: string;
      readonly color: string;
      readonly strokeWidth: number;
      readonly opacity: number;
    }
  | {
      readonly kind: 'text';
      /** Esquina izquierda de la línea base. */
      readonly x: number;
      readonly y: number;
      readonly fontSize: number;
      readonly text: string;
      readonly color: string;
      readonly opacity: number;
    }
  | {
      readonly kind: 'marker';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly borderWidth: number;
      readonly color: string;
      readonly opacity: number;
    };

const pixelPoints = (element: AnnotationElement, size: Size) =>
  element.points.map((point) => denormalizePoint(point, size));

/** Rectángulo aproximado que ocupa un texto: el punto queda a media altura, a la izquierda. */
function textBox(element: AnnotationElement, size: Size, scale: number) {
  const anchor = pixelPoints(element, size)[0] ?? { x: 0, y: 0 };
  const fontSize = (element.fontSize ?? DEFAULT_FONT_SIZE) * scale;
  const width = (element.text ?? '').length * fontSize * CHAR_WIDTH_RATIO;
  return {
    anchor,
    fontSize,
    left: anchor.x,
    right: anchor.x + width,
    top: anchor.y - fontSize / 2,
    bottom: anchor.y + fontSize / 2,
  };
}

/**
 * Qué hay que pintar para un elemento en un canvas de `size` píxeles.
 * `scale` multiplica grosores y tamaños de letra (ver `strokeScale`).
 */
export function elementDrawing(
  element: AnnotationElement,
  size: Size,
  scale: number,
): ElementDrawing | null {
  const points = pixelPoints(element, size);
  const [first, second] = points;
  if (!first) return null;
  const color = argbToCss(element.color);
  const strokeWidth = element.strokeWidth * scale;
  const stroke = (path: string): ElementDrawing => ({
    kind: 'stroke',
    path,
    color,
    strokeWidth,
    opacity: element.opacity,
  });
  const end = points[points.length - 1] ?? first;

  switch (element.type) {
    case 'freeStroke':
      return stroke(freeStrokePath(points));
    case 'line':
      return second ? stroke(linePath(first, end)) : null;
    case 'arrow':
      return second ? stroke(arrowPath(first, end, strokeWidth)) : null;
    case 'rectangle':
      return second ? stroke(rectanglePath(first, end)) : null;
    case 'circle':
      return second ? stroke(circlePath(first, end)) : null;
    case 'text': {
      if (!element.text) return null;
      const box = textBox(element, size, scale);
      return {
        kind: 'text',
        x: box.left,
        // Línea base para que el texto quede centrado en vertical sobre el punto.
        y: box.anchor.y + box.fontSize * 0.35,
        fontSize: box.fontSize,
        text: element.text,
        color,
        opacity: element.opacity,
      };
    }
    case 'marker': {
      const r = markerRadius(element.strokeWidth) * scale;
      return {
        kind: 'marker',
        cx: first.x,
        cy: first.y,
        r,
        borderWidth: Math.max(2, r * 0.25),
        color,
        opacity: element.opacity,
      };
    }
  }
}

// ── Detección de toque (borrador) ────────────────────────────────────────────

/** Distancia de un punto a un segmento. */
export function distanceToSegment(point: PixelPoint, a: PixelPoint, b: PixelPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, a);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function distanceToPolyline(point: PixelPoint, points: readonly PixelPoint[]): number {
  const [first] = points;
  if (!first) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return distance(point, first);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a && b) best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

/**
 * ¿El toque en `point` (píxeles) cae sobre el elemento? La tolerancia es
 * ~16 px más la mitad del grosor. Rectángulo y círculo solo por el borde.
 */
export function hitTestElement(
  element: AnnotationElement,
  point: PixelPoint,
  size: Size,
  scale: number,
  tolerance: number = DRAWING_THRESHOLDS.hitTolerancePx,
): boolean {
  const points = pixelPoints(element, size);
  const [first] = points;
  if (!first) return false;
  const end = points[points.length - 1] ?? first;
  const reach = tolerance + (element.strokeWidth * scale) / 2;

  switch (element.type) {
    case 'freeStroke':
      return distanceToPolyline(point, points) <= reach;
    case 'line':
    case 'arrow':
      return distanceToSegment(point, first, end) <= reach;
    case 'rectangle': {
      const corners = [
        { x: first.x, y: first.y },
        { x: end.x, y: first.y },
        { x: end.x, y: end.y },
        { x: first.x, y: end.y },
        { x: first.x, y: first.y },
      ];
      return distanceToPolyline(point, corners) <= reach;
    }
    case 'circle': {
      const { cx, cy, r } = circleGeometry(first, end);
      return Math.abs(distance(point, { x: cx, y: cy }) - r) <= reach;
    }
    case 'text': {
      const box = textBox(element, size, scale);
      return (
        point.x >= box.left - tolerance &&
        point.x <= box.right + tolerance &&
        point.y >= box.top - tolerance &&
        point.y <= box.bottom + tolerance
      );
    }
    case 'marker':
      return distance(point, first) <= markerRadius(element.strokeWidth) * scale + tolerance;
  }
}

/** Id del elemento más alto (el último dibujado) bajo el toque, o `null`. */
export function findElementAt(
  elements: readonly AnnotationElement[],
  point: PixelPoint,
  size: Size,
  scale: number,
): string | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element && hitTestElement(element, point, size, scale)) return element.id;
  }
  return null;
}
