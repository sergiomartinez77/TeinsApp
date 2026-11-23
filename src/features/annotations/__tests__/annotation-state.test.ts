import { ANNOTATIONS } from '@/constants/app.constants';
import type { AnnotationElement } from '@/models/annotation.model';

import { ANNOTATION_DEFAULTS, strokeSizeById } from '../constants';
import {
  annotationReducer,
  canRedo,
  canUndo,
  elementFromGesture,
  initialAnnotationState,
  type AnnotationState,
  type GestureInput,
} from '../services/annotation-state';

const element = (id: string, x = 50, y = 50): AnnotationElement => ({
  id,
  type: 'marker',
  points: [{ x, y }],
  color: 0xff000000,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
});

const ids = (elements: readonly AnnotationElement[]) => elements.map((item) => item.id);

const add = (state: AnnotationState, ...added: AnnotationElement[]) =>
  annotationReducer(state, { type: 'add', elements: added });

describe('annotationReducer', () => {
  it('añadir agrega al final (uno o varios a la vez) y guarda el estado anterior', () => {
    const start = initialAnnotationState([element('a')]);
    const state = add(start, element('b'), element('c'));

    expect(ids(state.elements)).toEqual(['a', 'b', 'c']);
    expect(state.history).toEqual([start.elements]);
    expect(state.revision).toBe(1);
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(false);
  });

  it('añadir una lista vacía no cambia nada', () => {
    const start = initialAnnotationState([element('a')]);

    expect(add(start)).toBe(start);
  });

  it('borrar quita los elementos indicados', () => {
    const start = initialAnnotationState([element('a'), element('b'), element('c')]);
    const state = annotationReducer(start, { type: 'remove', ids: ['a', 'c'] });

    expect(ids(state.elements)).toEqual(['b']);
    expect(state.history).toHaveLength(1);
    expect(state.revision).toBe(1);
  });

  it('borrar algo que no existe no cambia nada', () => {
    const start = initialAnnotationState([element('a')]);

    expect(annotationReducer(start, { type: 'remove', ids: ['x'] })).toBe(start);
  });

  it('mover desplaza solo los elementos indicados', () => {
    const start = initialAnnotationState([element('a', 0, 0), element('b', 10, 10)]);
    const state = annotationReducer(start, { type: 'move', ids: ['b'], dx: 5, dy: -2.5 });

    expect(state.elements[0]).toBe(start.elements[0]);
    expect(state.elements[1]?.points).toEqual([{ x: 15, y: 7.5 }]);
    expect(state.history).toHaveLength(1);
    expect(state.revision).toBe(1);
  });

  it('mover cero o mover algo que no existe no cambia nada', () => {
    const start = initialAnnotationState([element('a')]);

    expect(annotationReducer(start, { type: 'move', ids: ['a'], dx: 0, dy: 0 })).toBe(start);
    expect(annotationReducer(start, { type: 'move', ids: ['x'], dx: 5, dy: 5 })).toBe(start);
    expect(annotationReducer(start, { type: 'move', ids: [], dx: 5, dy: 5 })).toBe(start);
  });

  it('deshacer restaura lo borrado con el borrador', () => {
    const start = initialAnnotationState([element('a'), element('b')]);
    const erased = annotationReducer(start, { type: 'remove', ids: ['a'] });
    const restored = annotationReducer(erased, { type: 'undo' });

    expect(ids(restored.elements)).toEqual(['a', 'b']);
    expect(canUndo(restored)).toBe(false);
    expect(canRedo(restored)).toBe(true);
    // Deshacer también es un cambio que hay que guardar.
    expect(restored.revision).toBe(2);
  });

  it('deshacer un movimiento devuelve los puntos originales', () => {
    const start = initialAnnotationState([element('a', 0, 0)]);
    const moved = annotationReducer(start, { type: 'move', ids: ['a'], dx: 30, dy: 40 });

    expect(annotationReducer(moved, { type: 'undo' }).elements).toBe(start.elements);
  });

  it('rehacer vuelve a aplicar lo deshecho, en orden', () => {
    let state = add(initialAnnotationState(), element('a'));
    state = add(state, element('b'));
    state = annotationReducer(state, { type: 'undo' });
    state = annotationReducer(state, { type: 'undo' });
    expect(ids(state.elements)).toEqual([]);

    state = annotationReducer(state, { type: 'redo' });
    expect(ids(state.elements)).toEqual(['a']);
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(true);

    state = annotationReducer(state, { type: 'redo' });
    expect(ids(state.elements)).toEqual(['a', 'b']);
    expect(canRedo(state)).toBe(false);
    expect(state.revision).toBe(6);
  });

  it('un cambio nuevo borra lo que se podía rehacer', () => {
    let state = add(initialAnnotationState(), element('a'));
    state = annotationReducer(state, { type: 'undo' });
    expect(canRedo(state)).toBe(true);

    state = add(state, element('b'));

    expect(canRedo(state)).toBe(false);
    expect(state.future).toEqual([]);
    expect(annotationReducer(state, { type: 'redo' })).toBe(state);
    expect(ids(state.elements)).toEqual(['b']);
  });

  it(`guarda como máximo ${ANNOTATIONS.maxUndoStates} estados anteriores`, () => {
    let state = initialAnnotationState();
    for (let index = 0; index < 25; index += 1) {
      state = add(state, element(`e${index}`));
    }
    expect(state.history).toHaveLength(ANNOTATIONS.maxUndoStates);

    for (let index = 0; index < 30; index += 1) {
      state = annotationReducer(state, { type: 'undo' });
    }
    // Se puede volver 20 pasos atrás: quedan los 5 primeros elementos.
    expect(ids(state.elements)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    expect(canUndo(state)).toBe(false);
    expect(state.future).toHaveLength(ANNOTATIONS.maxUndoStates);
  });

  it('deshacer o rehacer sin historial no hace nada', () => {
    const start = initialAnnotationState([element('a')]);

    expect(annotationReducer(start, { type: 'undo' })).toBe(start);
    expect(annotationReducer(start, { type: 'redo' })).toBe(start);
    expect(canUndo(start)).toBe(false);
    expect(canRedo(start)).toBe(false);
  });

  it('cargar reemplaza los elementos y reinicia el historial', () => {
    let state = add(initialAnnotationState(), element('a'));
    state = annotationReducer(state, { type: 'undo' });
    state = annotationReducer(state, { type: 'load', elements: [element('x'), element('y')] });

    expect(ids(state.elements)).toEqual(['x', 'y']);
    expect(state.history).toEqual([]);
    expect(state.future).toEqual([]);
    expect(state.revision).toBe(0);
  });

  it('el estado inicial no tiene historial ni cambios', () => {
    expect(initialAnnotationState()).toEqual({
      elements: [],
      history: [],
      future: [],
      revision: 0,
    });
  });
});

describe('elementFromGesture', () => {
  const medium = strokeSizeById('medium');
  const base: Omit<GestureInput, 'tool' | 'points'> = {
    id: 'nuevo',
    scale: 1,
    color: ANNOTATION_DEFAULTS.color,
    size: medium,
  };
  const drag = [
    { x: 20, y: 10 },
    { x: 50, y: 30 },
    { x: 100, y: 50 },
  ];

  it('una forma guarda el primer y el último punto del gesto, en centímetros', () => {
    for (const tool of ['line', 'arrow', 'rectangle', 'circle'] as const) {
      expect(elementFromGesture({ ...base, tool, points: drag })).toEqual({
        id: 'nuevo',
        type: tool,
        points: [
          { x: 20, y: 10 },
          { x: 100, y: 50 },
        ],
        color: ANNOTATION_DEFAULTS.color,
        strokeWidth: medium.strokeWidth,
        text: null,
        fontSize: null,
        opacity: 1,
      });
    }
  });

  it('cota: guarda el tamaño de letra en cm (×0,8 del texto)', () => {
    // 18 px en pantalla con escala 2 → 9 cm; la cota usa el 80 %: 7,2 cm.
    const created = elementFromGesture({ ...base, scale: 2, tool: 'dimension', points: drag });

    expect(created).toMatchObject({ type: 'dimension', text: null });
    expect(created?.fontSize).toBeCloseTo(7.2, 10);
  });

  it('las formas diminutas en pantalla se descartan (toque accidental)', () => {
    const tiny = [
      { x: 10, y: 10 },
      { x: 11, y: 12 },
    ];
    for (const tool of ['line', 'arrow', 'rectangle', 'circle', 'dimension'] as const) {
      expect(elementFromGesture({ ...base, tool, points: tiny })).toBeNull();
      // El mismo arrastre con mucho zoom (10 px por cm) sí es una forma.
      expect(elementFromGesture({ ...base, scale: 10, tool, points: tiny })).not.toBeNull();
    }
    // 2 m con 1 m = 1 px (escala 0,005) son 1 px en pantalla: se descarta.
    const long = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    expect(elementFromGesture({ ...base, scale: 0.005, tool: 'line', points: long })).toBeNull();
    // Un solo punto con una herramienta de dos puntos tampoco crea nada.
    expect(elementFromGesture({ ...base, tool: 'line', points: [{ x: 5, y: 5 }] })).toBeNull();
  });

  it('un toque con el lápiz crea un punto', () => {
    const created = elementFromGesture({ ...base, tool: 'freeStroke', points: [{ x: 50, y: 50 }] });

    expect(created).toMatchObject({ type: 'freeStroke', points: [{ x: 50, y: 50 }] });
  });

  it('el lápiz descarta puntos más cerca de 1,5 px según la escala', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 10, y: 0 },
    ];

    // Escala 1: 1,5 cm; se descarta (1, 0).
    expect(elementFromGesture({ ...base, tool: 'freeStroke', points })?.points).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 10, y: 0 },
    ]);
    // Escala 10: 0,15 cm; se conservan todos.
    expect(
      elementFromGesture({ ...base, scale: 10, tool: 'freeStroke', points })?.points,
    ).toHaveLength(4);
    // Escala 0,1: 15 cm; solo queda el primero.
    expect(elementFromGesture({ ...base, scale: 0.1, tool: 'freeStroke', points })?.points).toEqual(
      [{ x: 0, y: 0 }],
    );
  });

  it('texto: tamaño de letra en cm = tamaño en pantalla / escala; vacío no crea nada', () => {
    expect(
      elementFromGesture({ ...base, tool: 'text', points: [{ x: 20, y: 20 }], text: '  UPS 1 ' }),
    ).toMatchObject({ type: 'text', text: 'UPS 1', fontSize: 18, points: [{ x: 20, y: 20 }] });
    expect(
      elementFromGesture({
        ...base,
        scale: 0.5,
        size: strokeSizeById('thick'),
        tool: 'text',
        points: [{ x: 20, y: 20 }],
        text: 'Rack',
      }),
    ).toMatchObject({ fontSize: 48, strokeWidth: 6 });
    expect(
      elementFromGesture({ ...base, tool: 'text', points: [{ x: 20, y: 20 }], text: '   ' }),
    ).toBeNull();
    expect(elementFromGesture({ ...base, tool: 'text', points: [{ x: 20, y: 20 }] })).toBeNull();
  });

  it('marcador: un toque lo coloca en ese punto', () => {
    expect(
      elementFromGesture({ ...base, tool: 'marker', points: [{ x: 100, y: 25 }, ...drag] }),
    ).toMatchObject({ type: 'marker', points: [{ x: 100, y: 25 }], fontSize: null });
  });

  it('el color se guarda como entero sin signo', () => {
    const created = elementFromGesture({ ...base, color: -769226, tool: 'marker', points: drag });

    expect(created?.color).toBe(0xfff44336);
  });

  it('borrador, selección y mover vista nunca crean elementos', () => {
    for (const tool of ['eraser', 'select', 'pan'] as const) {
      expect(elementFromGesture({ ...base, tool, points: drag })).toBeNull();
    }
  });

  it('sin puntos no crea nada', () => {
    expect(elementFromGesture({ ...base, tool: 'line', points: [] })).toBeNull();
  });
});
