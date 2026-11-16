import { ANNOTATIONS } from '@/constants/app.constants';
import type { AnnotationElement } from '@/models/annotation.model';

import { ANNOTATION_DEFAULTS, strokeSizeById } from '../constants';
import {
  annotationReducer,
  canUndo,
  elementFromGesture,
  initialAnnotationState,
  type GestureInput,
} from '../services/annotation-state';

const element = (id: string): AnnotationElement => ({
  id,
  type: 'marker',
  points: [{ x: 0.5, y: 0.5 }],
  color: 0xff000000,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
});

const ids = (elements: readonly AnnotationElement[]) => elements.map((item) => item.id);

describe('annotationReducer', () => {
  it('añadir agrega al final y guarda el estado anterior', () => {
    const state = annotationReducer(initialAnnotationState([element('a')]), {
      type: 'add',
      element: element('b'),
    });

    expect(ids(state.elements)).toEqual(['a', 'b']);
    expect(state.history).toHaveLength(1);
    expect(state.revision).toBe(1);
    expect(canUndo(state)).toBe(true);
  });

  it('borrar quita los elementos indicados', () => {
    const start = initialAnnotationState([element('a'), element('b'), element('c')]);
    const state = annotationReducer(start, { type: 'remove', ids: ['a', 'c'] });

    expect(ids(state.elements)).toEqual(['b']);
    expect(state.history).toHaveLength(1);
  });

  it('borrar algo que no existe no cambia nada', () => {
    const start = initialAnnotationState([element('a')]);

    expect(annotationReducer(start, { type: 'remove', ids: ['x'] })).toBe(start);
  });

  it('deshacer restaura lo borrado con el borrador', () => {
    const start = initialAnnotationState([element('a'), element('b')]);
    const erased = annotationReducer(start, { type: 'remove', ids: ['a'] });
    const restored = annotationReducer(erased, { type: 'undo' });

    expect(ids(restored.elements)).toEqual(['a', 'b']);
    expect(canUndo(restored)).toBe(false);
  });

  it('deshacer quita el último elemento añadido', () => {
    let state = initialAnnotationState();
    state = annotationReducer(state, { type: 'add', element: element('a') });
    state = annotationReducer(state, { type: 'add', element: element('b') });
    state = annotationReducer(state, { type: 'undo' });

    expect(ids(state.elements)).toEqual(['a']);
  });

  it('guarda como máximo 20 estados anteriores', () => {
    let state = initialAnnotationState();
    for (let index = 0; index < 25; index += 1) {
      state = annotationReducer(state, { type: 'add', element: element(`e${index}`) });
    }
    expect(state.history).toHaveLength(ANNOTATIONS.maxUndoStates);

    for (let index = 0; index < 30; index += 1) {
      state = annotationReducer(state, { type: 'undo' });
    }
    // Se puede volver 20 pasos atrás: quedan los 5 primeros elementos.
    expect(ids(state.elements)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    expect(canUndo(state)).toBe(false);
  });

  it('deshacer sin historial no hace nada', () => {
    const start = initialAnnotationState([element('a')]);

    expect(annotationReducer(start, { type: 'undo' })).toBe(start);
  });

  it('cargar reemplaza los elementos y reinicia el historial', () => {
    let state = annotationReducer(initialAnnotationState(), {
      type: 'add',
      element: element('a'),
    });
    state = annotationReducer(state, { type: 'load', elements: [element('x'), element('y')] });

    expect(ids(state.elements)).toEqual(['x', 'y']);
    expect(state.history).toEqual([]);
    expect(state.revision).toBe(0);
  });
});

describe('elementFromGesture', () => {
  const base: Omit<GestureInput, 'tool' | 'points'> = {
    id: 'nuevo',
    canvasSize: { width: 200, height: 100 },
    color: ANNOTATION_DEFAULTS.color,
    size: strokeSizeById('medium'),
  };

  it('las formas diminutas se descartan (toque accidental)', () => {
    for (const tool of ['line', 'arrow', 'rectangle', 'circle'] as const) {
      expect(
        elementFromGesture({
          ...base,
          tool,
          points: [
            { x: 10, y: 10 },
            { x: 11, y: 12 },
          ],
        }),
      ).toBeNull();
    }
  });

  it('una forma guarda el punto inicial y el final normalizados', () => {
    const created = elementFromGesture({
      ...base,
      tool: 'rectangle',
      points: [
        { x: 20, y: 10 },
        { x: 50, y: 30 },
        { x: 100, y: 50 },
      ],
    });

    expect(created).toMatchObject({
      id: 'nuevo',
      type: 'rectangle',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.5 },
      ],
      strokeWidth: 4,
      color: ANNOTATION_DEFAULTS.color,
      opacity: 1,
    });
  });

  it('un toque con el lápiz crea un punto', () => {
    const created = elementFromGesture({ ...base, tool: 'freeStroke', points: [{ x: 50, y: 50 }] });

    expect(created).toMatchObject({ type: 'freeStroke', points: [{ x: 0.25, y: 0.5 }] });
  });

  it('el lápiz descarta puntos demasiado cercanos', () => {
    const created = elementFromGesture({
      ...base,
      tool: 'freeStroke',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 10, y: 0 },
      ],
    });

    expect(created?.points).toHaveLength(3);
  });

  it('texto: con el tamaño de letra del grosor; vacío no crea nada', () => {
    expect(
      elementFromGesture({ ...base, tool: 'text', points: [{ x: 20, y: 20 }], text: '  UPS 1 ' }),
    ).toMatchObject({ type: 'text', text: 'UPS 1', fontSize: 18 });
    expect(
      elementFromGesture({ ...base, tool: 'text', points: [{ x: 20, y: 20 }], text: '   ' }),
    ).toBeNull();
  });

  it('marcador: un toque lo coloca en ese punto', () => {
    expect(
      elementFromGesture({ ...base, tool: 'marker', points: [{ x: 100, y: 25 }] }),
    ).toMatchObject({ type: 'marker', points: [{ x: 0.5, y: 0.25 }] });
  });

  it('el borrador nunca crea elementos', () => {
    expect(
      elementFromGesture({
        ...base,
        tool: 'eraser',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      }),
    ).toBeNull();
  });
});
