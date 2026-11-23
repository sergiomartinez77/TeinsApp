import { parseRecordSyncStatus, type RecordSyncStatus } from '@/models/visit.model';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('annotations');

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Tipos de elemento que se guardan (los 7 de la app original más la cota). */
export const ANNOTATION_ELEMENT_TYPES = [
  'freeStroke',
  'line',
  'arrow',
  'rectangle',
  'circle',
  'text',
  'marker',
  'dimension',
] as const;

export type AnnotationElementType = (typeof ANNOTATION_ELEMENT_TYPES)[number];

/**
 * Herramientas del plano: los tipos de elemento más las que no crean nada
 * (borrador, selección y mover la vista).
 */
export type AnnotationTool = AnnotationElementType | 'eraser' | 'select' | 'pan';

/**
 * Formato de los elementos guardados (`annotations.format_version`):
 * - 1: puntos normalizados (0–1) respecto a `canvas_width` × `canvas_height`
 *   y grosores que crecen con el lienzo (app original y primeras versiones).
 * - 2: coordenadas del plano en centímetros, sin límites; los grosores son
 *   píxeles de pantalla (no cambian con el zoom) y el texto, centímetros.
 *
 * La app lee los dos y siempre guarda el 2.
 */
export const PLAN_FORMAT_VERSION = 2;

/** Punto del plano en centímetros (formato 2). */
export interface PlanPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Elemento del plano. Puntos en centímetros; `strokeWidth` en píxeles de
 * pantalla; `fontSize` en centímetros; `color` es un entero ARGB de 32 bits.
 */
export interface AnnotationElement {
  readonly id: string;
  readonly type: AnnotationElementType;
  readonly points: readonly PlanPoint[];
  readonly color: number;
  readonly strokeWidth: number;
  readonly text: string | null;
  readonly fontSize: number | null;
  readonly opacity: number;
}

/** Plano de una visita (una visita puede tener varios). */
export interface VisitAnnotation {
  readonly id: string;
  readonly visitId: string;
  readonly title: string | null;
  /** Elementos ya en centímetros, aunque la fila esté guardada en el formato 1. */
  readonly elements: readonly AnnotationElement[];
  readonly baseImagePath: string | null;
  /** Formato en que está guardada la fila (1 o 2). */
  readonly formatVersion: number;
  readonly canvasWidth: number | null;
  readonly canvasHeight: number | null;
  readonly syncStatus: RecordSyncStatus;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** Figura guardada por el técnico para reutilizarla en cualquier plano. */
export interface AnnotationFigure {
  readonly id: string;
  readonly technicianId: string;
  readonly name: string;
  /** Elementos con la esquina superior izquierda de la figura en (0, 0). */
  readonly elements: readonly AnnotationElement[];
  /** Tamaño de la figura en centímetros. */
  readonly width: number;
  readonly height: number;
  readonly createdAt: string;
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

/** Tamaño que se supone para un plano antiguo sin referencia guardada. */
export const LEGACY_DEFAULT_REFERENCE = { width: 400, height: 600 } as const;

export interface ParseOptions {
  /** Formato de los datos (por defecto, 2). */
  formatVersion?: number;
  /** Solo formato 1: tamaño con el que se convierten los puntos normalizados. */
  reference?: { width: number; height: number } | null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function parseType(value: unknown): AnnotationElementType | null {
  return ANNOTATION_ELEMENT_TYPES.find((type) => type === value) ?? null;
}

type PointMapper = (x: number, y: number) => PlanPoint;

function parsePoints(value: unknown, map: PointMapper): PlanPoint[] {
  if (!Array.isArray(value)) return [];
  const points: PlanPoint[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const x = finite(item.x);
    const y = finite(item.y);
    if (x === null || y === null) continue;
    points.push(map(x, y));
  }
  return points;
}

/** Tipos que necesitan dos puntos (inicio y fin). */
const TWO_POINT_TYPES: ReadonlySet<AnnotationElementType> = new Set([
  'line',
  'arrow',
  'rectangle',
  'circle',
  'dimension',
]);

/** Convierte un objeto guardado en elemento; `null` si no se puede dibujar. */
function parseElement(value: unknown, index: number, map: PointMapper): AnnotationElement | null {
  if (!isRecord(value)) return null;
  const type = parseType(value.type);
  // Tipos desconocidos y el borrador (dato heredado de la app original) no se dibujan.
  if (!type) return null;
  const points = parsePoints(value.points, map);
  if (points.length === 0) return null;
  if (TWO_POINT_TYPES.has(type) && points.length < 2) return null;
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

function pointMapper(options: ParseOptions): PointMapper {
  if ((options.formatVersion ?? PLAN_FORMAT_VERSION) !== 1) return (x, y) => ({ x, y });
  // Formato 1: cada píxel del lienzo de referencia pasa a ser un centímetro.
  const reference = options.reference;
  const width = reference && reference.width > 0 ? reference.width : LEGACY_DEFAULT_REFERENCE.width;
  const height =
    reference && reference.height > 0 ? reference.height : LEGACY_DEFAULT_REFERENCE.height;
  return (x, y) => ({ x: clamp01(x) * width, y: clamp01(y) * height });
}

/**
 * Lee la lista de elementos guardada (texto JSON o lista ya decodificada) y
 * la devuelve en centímetros. Descarta, con aviso en el registro, lo que no
 * se puede dibujar. Nunca lanza: un JSON inválido da una lista vacía.
 */
export function parseElements(value: unknown, options: ParseOptions = {}): AnnotationElement[] {
  if (value === null || value === undefined || value === '') return [];
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch (error) {
      log.warn('Los elementos del plano no son un JSON válido', error);
      return [];
    }
  }
  if (!Array.isArray(decoded)) {
    log.warn('Los elementos del plano no son una lista');
    return [];
  }

  const map = pointMapper(options);
  const elements: AnnotationElement[] = [];
  decoded.forEach((item, index) => {
    const element = parseElement(item, index, map);
    if (element) elements.push(element);
  });
  const discarded = decoded.length - elements.length;
  if (discarded > 0) log.warn(`Se descartaron ${discarded} elementos del plano no válidos`);
  return elements;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** JSON a guardar (formato 2). Coordenadas en centímetros con 2 decimales. */
export function serializeElements(elements: readonly AnnotationElement[]): string {
  return JSON.stringify(
    elements.map((element) => ({
      id: element.id,
      type: element.type,
      points: element.points.map((point) => ({ x: round2(point.x), y: round2(point.y) })),
      color: element.color >>> 0,
      strokeWidth: element.strokeWidth,
      text: element.text,
      fontSize: element.fontSize === null ? null : round2(element.fontSize),
      opacity: element.opacity,
    })),
  );
}

// ── Filas de SQLite ──────────────────────────────────────────────────────────

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const toNumber = (value: unknown): unknown => (typeof value === 'string' ? Number(value) : value);
const positive = (value: unknown): number | null => {
  const number = toNumber(value);
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
};

/** Formato guardado en la fila: 2 solo si lo dice; cualquier otro valor es el formato 1. */
export function parseFormatVersion(value: unknown): number {
  return toNumber(value) === PLAN_FORMAT_VERSION ? PLAN_FORMAT_VERSION : 1;
}

/** Convierte una fila de `annotations` en un plano de la visita (elementos en centímetros). */
export function annotationFromRow(row: Record<string, unknown>): VisitAnnotation {
  const formatVersion = parseFormatVersion(row.format_version);
  const canvasWidth = positive(row.canvas_width);
  const canvasHeight = positive(row.canvas_height);
  const reference =
    canvasWidth !== null && canvasHeight !== null
      ? { width: canvasWidth, height: canvasHeight }
      : null;
  return {
    id: String(row.id),
    visitId: text(row.visit_id) ?? '',
    title: text(row.title),
    elements: parseElements(row.elements, { formatVersion, reference }),
    baseImagePath: text(row.base_image_path),
    formatVersion,
    canvasWidth,
    canvasHeight,
    syncStatus: parseRecordSyncStatus(row.sync_status),
    createdAt: text(row.created_at) ?? '',
    updatedAt: text(row.updated_at),
  };
}

/** Convierte una fila de `annotation_figures` en una figura. */
export function figureFromRow(row: Record<string, unknown>): AnnotationFigure {
  return {
    id: String(row.id),
    technicianId: text(row.technician_id) ?? '',
    name: text(row.name) ?? 'Figura',
    elements: parseElements(row.elements),
    width: positive(row.width) ?? 0,
    height: positive(row.height) ?? 0,
    createdAt: text(row.created_at) ?? '',
  };
}

// ── Textos ───────────────────────────────────────────────────────────────────

/** "0 elementos" / "1 elemento" / "N elementos". */
export function elementCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'elemento' : 'elementos'}`;
}

/** "1 plano" / "N planos". */
export function planCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'plano' : 'planos'}`;
}

/** Nombre visible de un plano: su título o "Plano N" según su posición (desde 1). */
export function planTitle(annotation: Pick<VisitAnnotation, 'title'>, position: number): string {
  const title = annotation.title?.trim();
  return title ? title : `Plano ${position}`;
}

/** Longitud máxima del nombre de un plano o de una figura. */
export const PLAN_NAME_MAX_LENGTH = 60;
