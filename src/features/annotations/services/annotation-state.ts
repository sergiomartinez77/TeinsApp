import { ANNOTATIONS } from '@/constants/app.constants';
import type { AnnotationElement, AnnotationTool } from '@/models/annotation.model';

import { DRAWING_THRESHOLDS, TWO_POINT_TOOLS, type StrokeSize } from '../constants';

import { appendPoint, distance, translateElement, type Point } from './geometry';

// ── Estado del plano ─────────────────────────────────────────────────────────

type ElementList = readonly AnnotationElement[];

export interface AnnotationState {
  readonly elements: ElementList;
  /** Estados anteriores de la lista, del más antiguo al más reciente. */
  readonly history: readonly ElementList[];
  /** Estados deshechos que se pueden rehacer (el más reciente al final). */
  readonly future: readonly ElementList[];
  /** Aumenta con cada cambio del técnico; vuelve a 0 al cargar. */
  readonly revision: number;
}

export type AnnotationAction =
  | { readonly type: 'add'; readonly elements: ElementList }
  | { readonly type: 'remove'; readonly ids: readonly string[] }
  | {
      readonly type: 'move';
      readonly ids: readonly string[];
      readonly dx: number;
      readonly dy: number;
    }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'load'; readonly elements: ElementList };

/** Estado inicial con los elementos guardados y sin historial. */
export function initialAnnotationState(elements: ElementList = []): AnnotationState {
  return { elements, history: [], future: [], revision: 0 };
}

/** Guarda el estado actual en el historial (como máximo 20 estados). */
function pushHistory(state: AnnotationState): AnnotationState['history'] {
  const history = [...state.history, state.elements];
  return history.slice(Math.max(0, history.length - ANNOTATIONS.maxUndoStates));
}

/** Cambio del técnico: entra en el historial y borra lo que se podía rehacer. */
function change(state: AnnotationState, elements: ElementList): AnnotationState {
  return { elements, history: pushHistory(state), future: [], revision: state.revision + 1 };
}

/**
 * Reductor puro del plano: añadir, borrar, mover, deshacer, rehacer y
 * cargar. Si una acción no cambia nada devuelve el mismo estado.
 */
export function annotationReducer(
  state: AnnotationState,
  action: AnnotationAction,
): AnnotationState {
  switch (action.type) {
    case 'add':
      if (action.elements.length === 0) return state;
      return change(state, [...state.elements, ...action.elements]);
    case 'remove': {
      const ids = new Set(action.ids);
      const elements = state.elements.filter((element) => !ids.has(element.id));
      if (elements.length === state.elements.length) return state;
      return change(state, elements);
    }
    case 'move': {
      const ids = new Set(action.ids);
      const moved = state.elements.some((element) => ids.has(element.id));
      if (!moved || (action.dx === 0 && action.dy === 0)) return state;
      return change(
        state,
        state.elements.map((element) =>
          ids.has(element.id) ? translateElement(element, action.dx, action.dy) : element,
        ),
      );
    }
    case 'undo': {
      const previous = state.history[state.history.length - 1];
      if (!previous) return state;
      return {
        elements: previous,
        history: state.history.slice(0, -1),
        future: [...state.future, state.elements],
        revision: state.revision + 1,
      };
    }
    case 'redo': {
      const next = state.future[state.future.length - 1];
      if (!next) return state;
      return {
        elements: next,
        history: pushHistory(state),
        future: state.future.slice(0, -1),
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

export function canRedo(state: AnnotationState): boolean {
  return state.future.length > 0;
}

// ── Elementos a partir de un gesto ───────────────────────────────────────────

export interface GestureInput {
  /** Id del elemento nuevo (lo genera quien llama). */
  id: string;
  tool: AnnotationTool;
  /** Puntos del gesto en centímetros del plano, en orden (ya ajustados si toca). */
  points: readonly Point[];
  /** Escala de la vista al dibujar (píxeles por cm). */
  scale: number;
  color: number;
  size: StrokeSize;
  /** Solo para la herramienta de texto. */
  text?: string;
}

/**
 * Crea el elemento que corresponde a un gesto terminado, o `null` si no
 * produce nada (borrador, selección, forma diminuta, texto vacío).
 * El texto y las cotas guardan el tamaño de letra en centímetros: el que se
 * ve en pantalla al escribirlo.
 */
export function elementFromGesture(input: GestureInput): AnnotationElement | null {
  const { tool, points, scale } = input;
  const [first] = points;
  if (!first || tool === 'eraser' || tool === 'select' || tool === 'pan') return null;

  const base = {
    id: input.id,
    color: input.color >>> 0,
    strokeWidth: input.size.strokeWidth,
    text: null,
    fontSize: null,
    opacity: 1,
  };
  const fontSizeCm = input.size.fontSize / scale;

  if (tool === 'freeStroke') {
    const minDistance = DRAWING_THRESHOLDS.minPointDistancePx / scale;
    const kept = points.reduce<readonly Point[]>(
      (accumulated, point) => appendPoint(accumulated, point, minDistance),
      [],
    );
    return { ...base, type: 'freeStroke', points: kept };
  }
  if (tool === 'text') {
    const text = (input.text ?? '').trim();
    if (!text) return null;
    return { ...base, type: 'text', points: [first], text, fontSize: fontSizeCm };
  }
  if (tool === 'marker') return { ...base, type: 'marker', points: [first] };

  // Formas de dos puntos.
  const last = points[points.length - 1] ?? first;
  if (!TWO_POINT_TOOLS.has(tool)) return null;
  if (distance(first, last) * scale < DRAWING_THRESHOLDS.minShapeSizePx) return null;
  return {
    ...base,
    type: tool,
    points: [first, last],
    fontSize: tool === 'dimension' ? fontSizeCm * 0.8 : null,
  };
}
