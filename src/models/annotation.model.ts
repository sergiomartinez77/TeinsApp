import { parseRecordSyncStatus, type RecordSyncStatus } from '@/models/visit.model';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('annotations');

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Tipos de elemento que se guardan (compatibles con la app original). */
export const ANNOTATION_ELEMENT_TYPES = [
  'freeStroke',
  'line',
  'arrow',
  'rectangle',
  'circle',
  'text',
  'marker',
] as const;

export type AnnotationElementType = (typeof ANNOTATION_ELEMENT_TYPES)[number];

/** Herramientas del dibujo: los tipos de elemento más el borrador (que no se guarda). */
export type AnnotationTool = AnnotationElementType | 'eraser';

/** Punto con coordenadas normalizadas (0.0–1.0) respecto al ancho y alto del canvas. */
export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Elemento del dibujo. `strokeWidth` y `fontSize` están en unidades del
 * tamaño de referencia del canvas; `color` es un entero ARGB de 32 bits.
 */
export interface AnnotationElement {
  readonly id: string;
  readonly type: AnnotationElementType;
  readonly points: readonly CanvasPoint[];
  readonly color: number;
  readonly strokeWidth: number;
  readonly text: string | null;
  readonly fontSize: number | null;
  readonly opacity: number;
}

/** Anotación de una visita: hay como máximo una por visita. */
export interface VisitAnnotation {
  readonly id: string;
  readonly visitId: string;
  readonly title: string | null;
  readonly elements: readonly AnnotationElement[];
  readonly baseImagePath: string | null;
  /** Tamaño de referencia del canvas (proporción y escala de los grosores). */
  readonly canvasWidth: number | null;
  readonly canvasHeight: number | null;
  readonly syncStatus: RecordSyncStatus;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

// ── Colores ARGB ─────────────────────────────────────────────────────────────

/** Negro opaco: color por defecto si un elemento guardado no trae uno válido. */
const OPAQUE_BLACK = 0xff000000;

/** Convierte un entero ARGB de 32 bits (como `Color.value` de Flutter) a `rgba(r, g, b, a)`. */
export function argbToCss(value: number): string {
  const argb = value >>> 0;
  const alpha = (argb >>> 24) & 0xff;
  const red = (argb >>> 16) & 0xff;
  const green = (argb >>> 8) & 0xff;
  const blue = argb & 0xff;
  return `rgba(${red}, ${green}, ${blue}, ${Number((alpha / 255).toFixed(3))})`;
}

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

/** Convierte `#RRGGBB` a entero ARGB opaco (alfa 255). Un texto no válido da negro. */
export function hexToArgb(hex: string): number {
  const match = HEX_COLOR.exec(hex);
  if (!match?.[1]) return OPAQUE_BLACK;
  return (0xff000000 | parseInt(match[1], 16)) >>> 0;
}

// ── Lectura tolerante ────────────────────────────────────────────────────────

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function parseType(value: unknown): AnnotationElementType | null {
  return ANNOTATION_ELEMENT_TYPES.find((type) => type === value) ?? null;
}

function parsePoints(value: unknown): CanvasPoint[] {
  if (!Array.isArray(value)) return [];
  const points: CanvasPoint[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const x = finite(item.x);
    const y = finite(item.y);
    if (x === null || y === null) continue;
    points.push({ x: clamp01(x), y: clamp01(y) });
  }
  return points;
}

/** Convierte un objeto guardado en elemento; `null` si no se puede dibujar. */
function parseElement(value: unknown, index: number): AnnotationElement | null {
  if (!isRecord(value)) return null;
  const type = parseType(value.type);
  // Tipos desconocidos y el borrador (dato heredado de la app original) no se dibujan.
  if (!type) return null;
  const points = parsePoints(value.points);
  if (points.length === 0) return null;
  const text = typeof value.text === 'string' && value.text.trim().length > 0 ? value.text : null;
  if (type === 'text' && !text) return null;

  const color = finite(value.color);
  const strokeWidth = finite(value.strokeWidth);
  const fontSize = finite(value.fontSize);
  const opacity = finite(value.opacity);
  return {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : `elemento-${index}`,
    type,
    points,
    color: color === null ? OPAQUE_BLACK : color >>> 0,
    strokeWidth: strokeWidth !== null && strokeWidth > 0 ? strokeWidth : 2,
    text,
    fontSize: fontSize !== null && fontSize > 0 ? fontSize : null,
    opacity: opacity === null ? 1 : clamp01(opacity),
  };
}

/**
 * Lee la lista de elementos guardada (texto JSON o lista ya decodificada).
 * Descarta, con aviso en el registro, lo que no se puede dibujar. Nunca lanza:
 * un JSON inválido da una lista vacía.
 */
export function parseElements(value: unknown): AnnotationElement[] {
  if (value === null || value === undefined || value === '') return [];
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch (error) {
      log.warn('Los elementos de la anotación no son un JSON válido', error);
      return [];
    }
  }
  if (!Array.isArray(decoded)) {
    log.warn('Los elementos de la anotación no son una lista');
    return [];
  }

  const elements: AnnotationElement[] = [];
  decoded.forEach((item, index) => {
    const element = parseElement(item, index);
    if (element) elements.push(element);
  });
  const discarded = decoded.length - elements.length;
  if (discarded > 0) log.warn(`Se descartaron ${discarded} elementos de la anotación no válidos`);
  return elements;
}

const round4 = (value: number) => Math.round(value * 10000) / 10000;

/** JSON a guardar, en el formato de la app original. Coordenadas con 4 decimales. */
export function serializeElements(elements: readonly AnnotationElement[]): string {
  return JSON.stringify(
    elements.map((element) => ({
      id: element.id,
      type: element.type,
      points: element.points.map((point) => ({ x: round4(point.x), y: round4(point.y) })),
      color: element.color >>> 0,
      strokeWidth: element.strokeWidth,
      text: element.text,
      fontSize: element.fontSize,
      opacity: element.opacity,
    })),
  );
}

// ── Fila de SQLite ───────────────────────────────────────────────────────────

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const positive = (value: unknown): number | null => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
};

/** Convierte una fila de `annotations` en la anotación de la visita. */
export function annotationFromRow(row: Record<string, unknown>): VisitAnnotation {
  return {
    id: String(row.id),
    visitId: text(row.visit_id) ?? '',
    title: text(row.title),
    elements: parseElements(row.elements),
    baseImagePath: text(row.base_image_path),
    canvasWidth: positive(row.canvas_width),
    canvasHeight: positive(row.canvas_height),
    syncStatus: parseRecordSyncStatus(row.sync_status),
    createdAt: text(row.created_at) ?? '',
    updatedAt: text(row.updated_at),
  };
}

/** "0 elementos" / "1 elemento" / "N elementos". */
export function elementCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'elemento' : 'elementos'}`;
}
