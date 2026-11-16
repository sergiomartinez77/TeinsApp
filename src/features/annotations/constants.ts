import type { IconName } from '@/components/ui/Icon';
import { hexToArgb, type AnnotationTool } from '@/models/annotation.model';

/**
 * Datos del dominio del dibujo: herramientas, paleta y grosores.
 * Los colores de la paleta son datos de los elementos (se guardan como ARGB),
 * no colores de la interfaz: por eso viven aquí y no en el tema.
 */

export interface ToolOption {
  tool: AnnotationTool;
  label: string;
  icon: IconName;
}

export const ANNOTATION_TOOLS: readonly ToolOption[] = [
  { tool: 'freeStroke', label: 'Lápiz', icon: 'edit' },
  { tool: 'line', label: 'Línea', icon: 'horizontal-rule' },
  { tool: 'arrow', label: 'Flecha', icon: 'arrow-right-alt' },
  { tool: 'rectangle', label: 'Rectángulo', icon: 'crop-square' },
  { tool: 'circle', label: 'Círculo', icon: 'radio-button-unchecked' },
  { tool: 'text', label: 'Texto', icon: 'title' },
  { tool: 'marker', label: 'Marcador', icon: 'place' },
  { tool: 'eraser', label: 'Borrador', icon: 'auto-fix-normal' },
];

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
  /** Grosor del trazo en unidades de la referencia del canvas. */
  strokeWidth: number;
  /** Tamaño del texto en unidades de la referencia del canvas. */
  fontSize: number;
}

export const STROKE_SIZES: readonly StrokeSize[] = [
  { id: 'thin', label: 'fino', strokeWidth: 2, fontSize: 14 },
  { id: 'medium', label: 'medio', strokeWidth: 4, fontSize: 18 },
  { id: 'thick', label: 'grueso', strokeWidth: 8, fontSize: 24 },
];

const BLUE = ANNOTATION_PALETTE[2] ?? paletteColor('azul', '#0D4F8B');
const MEDIUM = STROKE_SIZES[1] ?? { id: 'medium', label: 'medio', strokeWidth: 4, fontSize: 18 };

export const ANNOTATION_DEFAULTS = {
  tool: 'freeStroke' as AnnotationTool,
  color: BLUE.argb,
  size: MEDIUM.id,
} as const;

/** Busca un grosor por id (por defecto, el medio). */
export function strokeSizeById(id: StrokeSizeId): StrokeSize {
  return STROKE_SIZES.find((size) => size.id === id) ?? MEDIUM;
}

/** Texto de un elemento de texto: como máximo 120 caracteres. */
export const TEXT_MAX_LENGTH = 120;

/** Celdas de la cuadrícula del lienzo a lo ancho. */
export const GRID_COLUMNS = 20;

/** Umbrales del dibujo en píxeles del canvas. */
export const DRAWING_THRESHOLDS = {
  /** El lápiz descarta puntos más cerca que esto del anterior. */
  minPointDistancePx: 1.5,
  /** Formas con un arrastre menor se descartan (toque accidental). */
  minShapeSizePx: 3,
  /** Tolerancia táctil del borrador (más la mitad del grosor del elemento). */
  hitTolerancePx: 16,
} as const;
