import { argbToCss, type AnnotationElement, type PlanPoint } from '@/models/annotation.model';

import {
  ANGLE_SNAP_DEGREES,
  DRAWING_THRESHOLDS,
  GRID_MIN_SPACING_PX,
  GRID_STEPS_CM,
  PLAN_ZOOM,
  SCALE_BAR_TARGET_PX,
} from '../constants';

/**
 * Geometría del plano, sin dependencias nativas: el lienzo convierte las
 * cadenas de trazado SVG con Skia y aquí se prueban sin él.
 *
 * Unidades: los elementos guardan puntos en centímetros del plano. La vista
 * (`Viewport`) convierte a píxeles de pantalla: pantalla = plano × escala + t.
 * Los grosores son píxeles de pantalla: no cambian con el zoom.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Punto (en centímetros del plano o en píxeles, según el contexto). */
export type Point = PlanPoint;
/** @deprecated Nombre antiguo de {@link Point}. */
export type PixelPoint = Point;

/** Vista del plano: `scale` son píxeles por centímetro; `tx`/`ty`, el desplazamiento. */
export interface Viewport {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const isValidSize = (size: Size | null | undefined): size is Size =>
  Boolean(size && size.width > 0 && size.height > 0);

// ── Vista ────────────────────────────────────────────────────────────────────

/** Escala dentro de los límites del zoom. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return PLAN_ZOOM.initial;
  return Math.min(PLAN_ZOOM.max, Math.max(PLAN_ZOOM.min, scale));
}

export function screenToWorld(point: Point, view: Viewport): Point {
  return { x: (point.x - view.tx) / view.scale, y: (point.y - view.ty) / view.scale };
}

export function worldToScreen(point: Point, view: Viewport): Point {
  return { x: point.x * view.scale + view.tx, y: point.y * view.scale + view.ty };
}

/** Acerca o aleja `factor` veces manteniendo fijo el punto de pantalla `focal`. */
export function zoomAround(view: Viewport, focal: Point, factor: number): Viewport {
  const scale = clampScale(view.scale * factor);
  const world = screenToWorld(focal, view);
  return { scale, tx: focal.x - world.x * scale, ty: focal.y - world.y * scale };
}

/** Centro de la pantalla en centímetros del plano. */
export function viewCenter(view: Viewport, area: Size): Point {
  return screenToWorld({ x: area.width / 2, y: area.height / 2 }, view);
}

/**
 * Vista que encuadra `bounds` en el área con un margen. Sin contenido (o con
 * un área vacía) usa el zoom inicial con el origen del plano en el centro.
 */
export function fitViewport(bounds: Bounds | null, area: Size): Viewport {
  const centerX = area.width / 2;
  const centerY = area.height / 2;
  if (!bounds || !isValidSize(area)) {
    return { scale: PLAN_ZOOM.initial, tx: centerX, ty: centerY };
  }
  const padding = Math.min(PLAN_ZOOM.fitPaddingPx, area.width / 4, area.height / 4);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const scaleX = width > 0 ? (area.width - padding * 2) / width : Number.POSITIVE_INFINITY;
  const scaleY = height > 0 ? (area.height - padding * 2) / height : Number.POSITIVE_INFINITY;
  const fitted = Math.min(scaleX, scaleY);
  // Un solo punto (o una línea recta) no fija el zoom en las dos direcciones.
  const scale = clampScale(Number.isFinite(fitted) ? fitted : PLAN_ZOOM.initial);
  const middleX = (bounds.minX + bounds.maxX) / 2;
  const middleY = (bounds.minY + bounds.maxY) / 2;
  return { scale, tx: centerX - middleX * scale, ty: centerY - middleY * scale };
}

// ── Cuadrícula y escala ──────────────────────────────────────────────────────

export interface GridSpacing {
  /** Paso de la cuadrícula fina en centímetros. */
  readonly minor: number;
  /** Paso de la cuadrícula marcada (el siguiente paso de la lista). */
  readonly major: number;
}

/** Pasos de la cuadrícula para la escala: la fina deja al menos ~14 px entre líneas. */
export function gridSpacing(scale: number): GridSpacing {
  const steps = GRID_STEPS_CM;
  const index = steps.findIndex((step) => step * scale >= GRID_MIN_SPACING_PX);
  const minorIndex = index === -1 ? steps.length - 1 : index;
  const minor = steps[minorIndex] ?? 1;
  const major = steps[minorIndex + 1] ?? minor * 10;
  return { minor, major };
}

/** Longitudes "redondas" en cm (1, 2, 5 × 10ⁿ) para la barra de escala. */
function niceLengths(): number[] {
  const lengths: number[] = [];
  for (let power = 0; power <= 6; power += 1) {
    for (const base of [1, 2, 5]) lengths.push(base * 10 ** power);
  }
  return lengths;
}
const NICE_LENGTHS = niceLengths();

export interface ScaleBar {
  /** Longitud representada en centímetros. */
  readonly lengthCm: number;
  /** Ancho de la barra en píxeles. */
  readonly widthPx: number;
  readonly label: string;
}

/** Barra de escala: la longitud redonda más larga que cabe en ~90 px. */
export function scaleBar(scale: number, targetPx: number = SCALE_BAR_TARGET_PX): ScaleBar {
  let lengthCm = NICE_LENGTHS[0] ?? 1;
  for (const candidate of NICE_LENGTHS) {
    if (candidate * scale <= targetPx) lengthCm = candidate;
  }
  return { lengthCm, widthPx: lengthCm * scale, label: formatLength(lengthCm) };
}

/** Número con coma decimal y sin ceros sobrantes a la derecha de la coma. */
function decimalFormat(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return trimmed.replace('.', ',');
}

/**
 * Longitud legible en español: "35 cm", "2,35 m", "1,2 km". Por debajo de
 * 1 cm, milímetros.
 */
export function formatLength(cm: number): string {
  const value = Math.abs(cm);
  // La unidad se elige con el valor ya redondeado: 99,6 cm es "1 m", no "100 cm".
  const below = (amount: number, decimals: number, limit: number) =>
    Number(amount.toFixed(decimals)) < limit;
  if (below(value * 10, 0, 10)) return `${decimalFormat(value * 10, 0)} mm`;
  const cmDecimals = value < 10 ? 1 : 0;
  if (below(value, cmDecimals, 100)) return `${decimalFormat(value, cmDecimals)} cm`;
  if (below(value / 100, 2, 1000)) return `${decimalFormat(value / 100, 2)} m`;
  return `${decimalFormat(value / 100000, 2)} km`;
}

// ── Ajuste (snap) ────────────────────────────────────────────────────────────

/** Punto en la intersección de la cuadrícula más cercana. */
export function snapToGrid(point: Point, step: number): Point {
  if (!(step > 0)) return point;
  return { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step };
}

/**
 * Extremo de una línea ajustado a múltiplos de 15° y con la longitud
 * redondeada al paso de la cuadrícula.
 */
export function snapSegmentEnd(
  start: Point,
  end: Point,
  step: number,
  degrees: number = ANGLE_SNAP_DEGREES,
): Point {
  const length = distance(start, end);
  if (length === 0) return end;
  const increment = (degrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(end.y - start.y, end.x - start.x) / increment) * increment;
  const snappedLength = step > 0 ? Math.max(step, Math.round(length / step) * step) : length;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    x: round(start.x + Math.cos(angle) * snappedLength),
    y: round(start.y + Math.sin(angle) * snappedLength),
  };
}

// ── Puntos y límites ─────────────────────────────────────────────────────────

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Añade un punto al trazo salvo que esté a menos de `minDistance` del anterior. */
export function appendPoint(
  points: readonly Point[],
  point: Point,
  minDistance: number = DRAWING_THRESHOLDS.minPointDistancePx,
): readonly Point[] {
  const last = points[points.length - 1];
  if (last && distance(last, point) < minDistance) return points;
  return [...points, point];
}

export function boundsOfPoints(points: readonly Point[]): Bounds | null {
  const [first] = points;
  if (!first) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Rectángulo normalizado a partir de dos esquinas cualesquiera. */
export function boundsFromCorners(a: Point, b: Point): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

export function containsPoint(bounds: Bounds, point: Point, margin = 0): boolean {
  return (
    point.x >= bounds.minX - margin &&
    point.x <= bounds.maxX + margin &&
    point.y >= bounds.minY - margin &&
    point.y <= bounds.maxY + margin
  );
}

/** Ancho aproximado de un carácter respecto al tamaño de letra. */
const CHAR_WIDTH_RATIO = 0.55;
/** Tamaño de letra (cm) si un texto guardado no trae uno. */
const DEFAULT_FONT_SIZE_CM = 18;

/** Rectángulo aproximado de un texto: el punto queda a media altura, a la izquierda. */
function textBox(anchor: Point, text: string, fontSize: number): Bounds {
  return {
    minX: anchor.x,
    maxX: anchor.x + text.length * fontSize * CHAR_WIDTH_RATIO,
    minY: anchor.y - fontSize / 2,
    maxY: anchor.y + fontSize / 2,
  };
}

/** Radio del marcador en píxeles de pantalla según el grosor. */
export function markerRadius(strokeWidth: number): number {
  return 4 + strokeWidth * 1.5;
}

/**
 * Límites de un elemento en centímetros. `scale` (píxeles por cm) hace falta
 * para lo que mide lo mismo en pantalla con cualquier zoom (el marcador).
 */
export function elementBounds(element: AnnotationElement, scale: number): Bounds | null {
  const [first] = element.points;
  if (!first) return null;
  switch (element.type) {
    case 'text':
      return textBox(first, element.text ?? '', element.fontSize ?? DEFAULT_FONT_SIZE_CM);
    case 'marker': {
      const r = markerRadius(element.strokeWidth) / scale;
      return { minX: first.x - r, minY: first.y - r, maxX: first.x + r, maxY: first.y + r };
    }
    case 'circle': {
      const r = distance(first, element.points[element.points.length - 1] ?? first);
      return { minX: first.x - r, minY: first.y - r, maxX: first.x + r, maxY: first.y + r };
    }
    case 'dimension': {
      const line = boundsOfPoints(element.points);
      const label = dimensionLabel(element);
      return unionBounds(line, label ? textBox(label.anchor, label.text, label.fontSize) : null);
    }
    default:
      return boundsOfPoints(element.points);
  }
}

/** Límites de todos los elementos, o `null` si no hay ninguno. */
export function contentBounds(
  elements: readonly AnnotationElement[],
  scale: number,
): Bounds | null {
  return elements.reduce<Bounds | null>(
    (bounds, element) => unionBounds(bounds, elementBounds(element, scale)),
    null,
  );
}

/** Desplaza un elemento `dx`, `dy` centímetros (con otro id si se pide). */
export function translateElement(
  element: AnnotationElement,
  dx: number,
  dy: number,
  id: string = element.id,
): AnnotationElement {
  return {
    ...element,
    id,
    points: element.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  };
}

// ── Trazados SVG (en centímetros del plano) ──────────────────────────────────

const num = (value: number) => String(Math.round(value * 1000) / 1000);
const pair = (point: Point) => `${num(point.x)} ${num(point.y)}`;

/**
 * Trazo libre suavizado: curvas cuadráticas que pasan por los puntos medios
 * y usan cada punto como control. Un solo punto dibuja un punto.
 */
export function freeStrokePath(points: readonly Point[]): string {
  const [first, second] = points;
  if (!first) return '';
  if (!second) return `M ${pair(first)} L ${pair({ x: first.x + 0.001, y: first.y })}`;
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

export function linePath(start: Point, end: Point): string {
  return `M ${pair(start)} L ${pair(end)}`;
}

/** Longitud mínima de la punta de flecha en píxeles. */
const ARROW_MIN_HEAD_PX = 12;
const ARROW_HEAD_ANGLE = Math.PI / 6;

/** Extremos de las dos alas de la punta (de longitud `headLength`), que nacen en `end`. */
export function arrowHead(start: Point, end: Point, headLength: number): [Point, Point] {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const wing = (offset: number): Point => ({
    x: end.x - headLength * Math.cos(angle + offset),
    y: end.y - headLength * Math.sin(angle + offset),
  });
  return [wing(-ARROW_HEAD_ANGLE), wing(ARROW_HEAD_ANGLE)];
}

/** Línea con punta en el extremo final. */
export function arrowPath(start: Point, end: Point, headLength: number): string {
  const [left, right] = arrowHead(start, end, headLength);
  return `${linePath(start, end)} M ${pair(left)} L ${pair(end)} L ${pair(right)}`;
}

/** Rectángulo definido por dos esquinas opuestas. */
export function rectanglePath(a: Point, b: Point): string {
  const { minX, minY, maxX, maxY } = boundsFromCorners(a, b);
  return `M ${pair({ x: minX, y: minY })} L ${pair({ x: maxX, y: minY })} L ${pair({
    x: maxX,
    y: maxY,
  })} L ${pair({ x: minX, y: maxY })} Z`;
}

export interface CircleGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** Círculo: el primer punto es el centro y el segundo un punto del borde. */
export function circleGeometry(center: Point, edge: Point): CircleGeometry {
  return { cx: center.x, cy: center.y, r: distance(center, edge) };
}

/** Círculo como dos semicircunferencias. */
export function circlePath(center: Point, edge: Point): string {
  const { cx, cy, r } = circleGeometry(center, edge);
  const radius = num(r);
  return `M ${num(cx - r)} ${num(cy)} A ${radius} ${radius} 0 1 0 ${num(cx + r)} ${num(
    cy,
  )} A ${radius} ${radius} 0 1 0 ${num(cx - r)} ${num(cy)} Z`;
}

/** Cota: la línea y una marca perpendicular de `tick` cm en cada extremo. */
export function dimensionPath(start: Point, end: Point, tick: number): string {
  const length = distance(start, end);
  if (length === 0) return linePath(start, end);
  const nx = (-(end.y - start.y) / length) * (tick / 2);
  const ny = ((end.x - start.x) / length) * (tick / 2);
  const mark = (point: Point) =>
    `M ${pair({ x: point.x - nx, y: point.y - ny })} L ${pair({ x: point.x + nx, y: point.y + ny })}`;
  return `${linePath(start, end)} ${mark(start)} ${mark(end)}`;
}

export interface DimensionLabel {
  readonly text: string;
  /** Punto de inicio del texto (a media altura). */
  readonly anchor: Point;
  readonly fontSize: number;
}

/** Texto de una cota: la longitud, centrado sobre la línea. */
export function dimensionLabel(element: AnnotationElement): DimensionLabel | null {
  const [start] = element.points;
  const end = element.points[element.points.length - 1];
  if (!start || !end || element.points.length < 2) return null;
  const length = distance(start, end);
  const text = formatLength(length);
  const fontSize = element.fontSize ?? Math.max(1, length / 8);
  const width = text.length * fontSize * CHAR_WIDTH_RATIO;
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return {
    text,
    fontSize,
    anchor: { x: middle.x - width / 2, y: middle.y - fontSize * 0.9 },
  };
}

// ── Qué se pinta para cada elemento ──────────────────────────────────────────

export type DrawingPart =
  | {
      readonly kind: 'stroke';
      /** Trazado en centímetros del plano. */
      readonly path: string;
      /** Grosor en píxeles de pantalla. */
      readonly strokeWidth: number;
    }
  | {
      readonly kind: 'text';
      /** Esquina izquierda de la línea base, en centímetros. */
      readonly x: number;
      readonly y: number;
      /** Tamaño de letra en centímetros. */
      readonly fontSize: number;
      readonly text: string;
    }
  | {
      readonly kind: 'marker';
      readonly cx: number;
      readonly cy: number;
      /** Radio y borde en píxeles de pantalla. */
      readonly r: number;
      readonly borderWidth: number;
    };

export interface ElementDrawing {
  readonly color: string;
  readonly opacity: number;
  readonly parts: readonly DrawingPart[];
}

const textPart = (anchor: Point, text: string, fontSize: number): DrawingPart => ({
  kind: 'text',
  x: anchor.x,
  // Línea base para que el texto quede centrado en vertical sobre el punto.
  y: anchor.y + fontSize * 0.35,
  fontSize,
  text,
});

/**
 * Qué hay que pintar para un elemento. `scale` (píxeles por cm) fija lo que
 * mide lo mismo en pantalla con cualquier zoom: puntas de flecha y marcas de
 * las cotas.
 */
export function elementDrawing(element: AnnotationElement, scale: number): ElementDrawing | null {
  const { points } = element;
  const [first, second] = points;
  if (!first) return null;
  const end = points[points.length - 1] ?? first;
  const stroke = (path: string): DrawingPart => ({
    kind: 'stroke',
    path,
    strokeWidth: element.strokeWidth,
  });
  const drawing = (parts: DrawingPart[]): ElementDrawing => ({
    color: argbToCss(element.color),
    opacity: element.opacity,
    parts,
  });

  switch (element.type) {
    case 'freeStroke':
      return drawing([stroke(freeStrokePath(points))]);
    case 'line':
      return second ? drawing([stroke(linePath(first, end))]) : null;
    case 'arrow': {
      if (!second) return null;
      const head = Math.max(ARROW_MIN_HEAD_PX, element.strokeWidth * 4) / scale;
      return drawing([stroke(arrowPath(first, end, head))]);
    }
    case 'rectangle':
      return second ? drawing([stroke(rectanglePath(first, end))]) : null;
    case 'circle':
      return second ? drawing([stroke(circlePath(first, end))]) : null;
    case 'dimension': {
      const label = dimensionLabel(element);
      if (!second || !label) return null;
      const tick = (DRAWING_THRESHOLDS.dimensionTickPx + element.strokeWidth * 2) / scale;
      return drawing([
        stroke(dimensionPath(first, end, tick)),
        textPart(label.anchor, label.text, label.fontSize),
      ]);
    }
    case 'text':
      if (!element.text) return null;
      return drawing([textPart(first, element.text, element.fontSize ?? DEFAULT_FONT_SIZE_CM)]);
    case 'marker': {
      const r = markerRadius(element.strokeWidth);
      return drawing([
        { kind: 'marker', cx: first.x, cy: first.y, r, borderWidth: Math.max(2, r * 0.25) },
      ]);
    }
  }
}

// ── Detección de toque (borrador y selección) ────────────────────────────────

/** Distancia de un punto a un segmento. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, a);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function distanceToPolyline(point: Point, points: readonly Point[]): number {
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
 * ¿El toque en `point` (centímetros) cae sobre el elemento? La tolerancia es
 * ~16 px de pantalla más la mitad del grosor. Rectángulo y círculo, solo por
 * el borde.
 */
export function hitTestElement(
  element: AnnotationElement,
  point: Point,
  scale: number,
  tolerancePx: number = DRAWING_THRESHOLDS.hitTolerancePx,
): boolean {
  const { points } = element;
  const [first] = points;
  if (!first) return false;
  const end = points[points.length - 1] ?? first;
  const tolerance = tolerancePx / scale;
  const reach = (tolerancePx + element.strokeWidth / 2) / scale;

  switch (element.type) {
    case 'freeStroke':
      return distanceToPolyline(point, points) <= reach;
    case 'line':
    case 'arrow':
      return distanceToSegment(point, first, end) <= reach;
    case 'dimension': {
      if (distanceToSegment(point, first, end) <= reach) return true;
      const label = dimensionLabel(element);
      return label
        ? containsPoint(textBox(label.anchor, label.text, label.fontSize), point, tolerance)
        : false;
    }
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
      const box = textBox(first, element.text ?? '', element.fontSize ?? DEFAULT_FONT_SIZE_CM);
      return containsPoint(box, point, tolerance);
    }
    case 'marker':
      return distance(point, first) <= (markerRadius(element.strokeWidth) + tolerancePx) / scale;
  }
}

/** Id del elemento más alto (el último dibujado) bajo el toque, o `null`. */
export function findElementAt(
  elements: readonly AnnotationElement[],
  point: Point,
  scale: number,
): string | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element && hitTestElement(element, point, scale)) return element.id;
  }
  return null;
}

/** Ids de los elementos que quedan enteros dentro del rectángulo. */
export function elementsInside(
  elements: readonly AnnotationElement[],
  area: Bounds,
  scale: number,
): string[] {
  return elements
    .filter((element) => {
      const bounds = elementBounds(element, scale);
      return bounds !== null && containsBounds(area, bounds);
    })
    .map((element) => element.id);
}
