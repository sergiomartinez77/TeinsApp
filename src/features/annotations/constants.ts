import type { IconName } from '@/components/ui/Icon';
import { hexToArgb, type AnnotationTool } from '@/models/annotation.model';

/**
 * Datos del dominio del plano: herramientas, paleta, grosores, zoom y
 * cuadrícula. Los colores de la paleta son datos de los elementos (se
 * guardan como ARGB), no colores de la interfaz: por eso viven aquí.
 *
 * Unidades: el plano se mide en centímetros. La escala de la vista es
 * píxeles de pantalla por centímetro.
 */

export interface ToolOption {
  tool: AnnotationTool;
  label: string;
  icon: IconName;
}

export const ANNOTATION_TOOLS: readonly ToolOption[] = [
  { tool: 'select', label: 'Seleccionar', icon: 'near-me' },
  { tool: 'pan', label: 'Mover vista', icon: 'pan-tool' },
  { tool: 'freeStroke', label: 'Lápiz', icon: 'edit' },
  { tool: 'line', label: 'Línea', icon: 'horizontal-rule' },
  { tool: 'arrow', label: 'Flecha', icon: 'arrow-right-alt' },
  { tool: 'rectangle', label: 'Rectángulo', icon: 'crop-square' },
  { tool: 'circle', label: 'Círculo', icon: 'radio-button-unchecked' },
  { tool: 'dimension', label: 'Cota', icon: 'straighten' },
  { tool: 'text', label: 'Texto', icon: 'title' },
  { tool: 'marker', label: 'Marcador', icon: 'place' },
  { tool: 'eraser', label: 'Borrador', icon: 'auto-fix-normal' },
];

/** Herramientas que crean un elemento arrastrando de un punto a otro. */
export const TWO_POINT_TOOLS: ReadonlySet<AnnotationTool> = new Set([
  'line',
  'arrow',
  'rectangle',
  'circle',
  'dimension',
]);

export interface PaletteColor {
  /** Nombre accesible del color. */
  name: string;
  hex: string;
  argb: number;
}

const paletteColor = (name: string, hex: string): PaletteColor => ({
  name,
  hex,
  argb: hexToArgb(hex),
});

export const ANNOTATION_PALETTE: readonly PaletteColor[] = [
  paletteColor('negro', '#1A1A2E'),
  paletteColor('rojo', '#C62828'),
  paletteColor('azul', '#0D4F8B'),
  paletteColor('verde', '#2E7D32'),
  paletteColor('naranja', '#F57F17'),
  paletteColor('morado', '#6A1B9A'),
];

export type StrokeSizeId = 'thin' | 'medium' | 'thick';

export interface StrokeSize {
  id: StrokeSizeId;
  label: string;
  /** Grosor del trazo en píxeles de pantalla (no cambia con el zoom). */
  strokeWidth: number;
  /** Tamaño del texto en pantalla al escribirlo; se guarda en centímetros. */
  fontSize: number;
}

export const STROKE_SIZES: readonly StrokeSize[] = [
  { id: 'thin', label: 'fino', strokeWidth: 1.5, fontSize: 14 },
  { id: 'medium', label: 'medio', strokeWidth: 3, fontSize: 18 },
  { id: 'thick', label: 'grueso', strokeWidth: 6, fontSize: 24 },
];

const BLUE = ANNOTATION_PALETTE[2] ?? paletteColor('azul', '#0D4F8B');
const MEDIUM = STROKE_SIZES[1] ?? { id: 'medium', label: 'medio', strokeWidth: 3, fontSize: 18 };

export const ANNOTATION_DEFAULTS = {
  tool: 'line' as AnnotationTool,
  color: BLUE.argb,
  size: MEDIUM.id,
  snap: true,
} as const;

/** Busca un grosor por id (por defecto, el medio). */
export function strokeSizeById(id: StrokeSizeId): StrokeSize {
  return STROKE_SIZES.find((size) => size.id === id) ?? MEDIUM;
}

/** Texto de un elemento de texto: como máximo 120 caracteres. */
export const TEXT_MAX_LENGTH = 120;

/** Zoom de la vista, en píxeles de pantalla por centímetro. */
export const PLAN_ZOOM = {
  /** 1 m = 0,5 px: caben más de 700 m en la pantalla de un teléfono. */
  min: 0.005,
  /** 1 cm = 25 px: para detalles pequeños. */
  max: 25,
  /** Plano nuevo: 1 m = 60 px. */
  initial: 0.6,
  /** Factor de los botones de acercar y alejar. */
  step: 1.6,
  /** Margen alrededor del contenido al encuadrar, en píxeles. */
  fitPaddingPx: 32,
} as const;

/**
 * Pasos posibles de la cuadrícula en centímetros: 1 cm, 5 cm, 10 cm, 50 cm,
 * 1 m, 5 m, 10 m, 50 m, 100 m, 500 m y 1 km.
 */
export const GRID_STEPS_CM: readonly number[] = [
  1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000,
];

/** La cuadrícula fina usa el paso más pequeño que deje al menos esta separación. */
export const GRID_MIN_SPACING_PX = 14;

/** Longitud objetivo de la barra de escala, en píxeles. */
export const SCALE_BAR_TARGET_PX = 90;

/** Ajuste de ángulos (líneas, flechas y cotas) en grados. */
export const ANGLE_SNAP_DEGREES = 15;

/** Umbrales del dibujo en píxeles de pantalla. */
export const DRAWING_THRESHOLDS = {
  /** El lápiz descarta puntos más cerca que esto del anterior. */
  minPointDistancePx: 1.5,
  /** Formas con un arrastre menor se descartan (toque accidental). */
  minShapeSizePx: 3,
  /** Tolerancia táctil del borrador y la selección (más la mitad del grosor). */
  hitTolerancePx: 16,
  /** Tamaño de las marcas de los extremos de una cota. */
  dimensionTickPx: 8,
} as const;

/** Desplazamiento de un duplicado respecto al original, en píxeles de pantalla. */
export const DUPLICATE_OFFSET_PX = 24;

/** Colores del papel del plano (datos del dibujo, no de la interfaz). */
export const PLAN_COLORS = {
  paper: '#FFFFFF',
  gridMinor: '#E6EEF6',
  gridMajor: '#C5D5E8',
  selection: '#0D7BD8',
  selectionFill: 'rgba(13, 123, 216, 0.08)',
} as const;
