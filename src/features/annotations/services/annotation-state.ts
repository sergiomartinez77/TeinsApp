import { ANNOTATIONS } from '@/constants/app.constants';
import type { AnnotationElement, AnnotationTool } from '@/models/annotation.model';

import { DRAWING_THRESHOLDS, type StrokeSize } from '../constants';

import { appendPoint, distance, normalizePoint, type PixelPoint, type Size } from './geometry';

// ── Estado del dibujo ────────────────────────────────────────────────────────

export interface AnnotationState {
  readonly elements: readonly AnnotationElement[];
  /** Estados anteriores de la lista, del más antiguo al más reciente. */
  readonly history: readonly (readonly AnnotationElement[])[];
  /** Aumenta con cada cambio del técnico; vuelve a 0 al cargar. */
  readonly revision: number;
}

export type AnnotationAction =
  | { readonly type: 'add'; readonly element: AnnotationElement }
  | { readonly type: 'remove'; readonly ids: readonly string[] }
  | { readonly type: 'undo' }
  | { readonly type: 'load'; readonly elements: readonly AnnotationElement[] };

/** Estado inicial con los elementos guardados y sin historial. */
export function initialAnnotationState(
  elements: readonly AnnotationElement[] = [],
): AnnotationState {
  return { elements, history: [], revision: 0 };
}

/** Guarda el estado actual en el historial (como máximo 20 estados). */
function pushHistory(state: AnnotationState): AnnotationState['history'] {
  const history = [...state.history, state.elements];
  return history.slice(Math.max(0, history.length - ANNOTATIONS.maxUndoStates));
}

/**
 * Reductor puro del dibujo: añadir, borrar, deshacer y cargar.
 * Si una acción no cambia nada devuelve el mismo estado.
 */
export function annotationReducer(
  state: AnnotationState,
  action: AnnotationAction,
): AnnotationState {
  switch (action.type) {
    case 'add':
      return {
        elements: [...state.elements, action.element],
        history: pushHistory(state),
        revision: state.revision + 1,
      };
    case 'remove': {
      const ids = new Set(action.ids);
      const elements = state.elements.filter((element) => !ids.has(element.id));
      if (elements.length === state.elements.length) return state;
      return { elements, history: pushHistory(state), revision: state.revision + 1 };
    }
    case 'undo': {
      const previous = state.history[state.history.length - 1];
      if (!previous) return state;
      return {
        elements: previous,
        history: state.history.slice(0, -1),
        revision: state.revision + 1,
      };
    }
    case 'load':
      return initialAnnotationState(action.elements);
  }
}

export function canUndo(state: AnnotationState): boolean {
  return state.history.length > 0;
}

// ── Elementos a partir de un gesto ───────────────────────────────────────────

export interface GestureInput {
  /** Id del elemento nuevo (lo genera quien llama). */
  id: string;
  tool: AnnotationTool;
  /** Puntos del gesto en píxeles del canvas, en orden. */
  points: readonly PixelPoint[];
  /** Tamaño actual del canvas en píxeles. */
  canvasSize: Size;
  color: number;
  size: StrokeSize;
  /** Solo para la herramienta de texto. */
  text?: string;
}

/**
 * Crea el elemento que corresponde a un gesto terminado, o `null` si no
 * produce nada (borrador, forma diminuta, texto vacío).
 */
export function elementFromGesture(input: GestureInput): AnnotationElement | null {
  const { tool, points, canvasSize } = input;
  const [first] = points;
  if (!first || tool === 'eraser') return null;

  const base = {
    id: input.id,
    color: input.color >>> 0,
    strokeWidth: input.size.strokeWidth,
    text: null,
    fontSize: null,
    opacity: 1,
  };
  const normalize = (point: PixelPoint) => normalizePoint(point, canvasSize);

  switch (tool) {
    case 'freeStroke': {
      const kept = points.reduce<readonly PixelPoint[]>(
        (accumulated, point) => appendPoint(accumulated, point),
        [],
      );
      return { ...base, type: 'freeStroke', points: kept.map(normalize) };
    }
    case 'text': {
      const text = (input.text ?? '').trim();
      if (!text) return null;
      return {
        ...base,
        type: 'text',
        points: [normalize(first)],
        text,
        fontSize: input.size.fontSize,
      };
    }
    case 'marker':
      return { ...base, type: 'marker', points: [normalize(first)] };
    case 'line':
    case 'arrow':
    case 'rectangle':
    case 'circle': {
      const last = points[points.length - 1] ?? first;
      if (distance(first, last) < DRAWING_THRESHOLDS.minShapeSizePx) return null;
      return { ...base, type: tool, points: [normalize(first), normalize(last)] };
    }
  }
}
