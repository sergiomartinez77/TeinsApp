/**
 * @jest-environment ./jest.skia-environment.js
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import type { AnnotationElement, AnnotationTool } from '@/models/annotation.model';

import { measureLabel, PlanCanvas } from '../components/PlanCanvas';
import { ANNOTATION_DEFAULTS, strokeSizeById } from '../constants';

// Reanimated y worklets no tienen módulo nativo en Jest: valores compartidos
// sencillos que Skia reconoce y lee con `.value`.
jest.mock('react-native-reanimated', () =>
  jest.requireActual('@/test-utils/reanimated-mock').reanimatedMock(),
);
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

/**
 * Área de 400 × 300 px sin contenido: escala inicial 0,6 px/cm con el origen
 * del plano en el centro → pantalla (200, 150) = plano (0, 0) y 60 px = 1 m.
 */
const AREA = { width: 400, height: 300 };

const element = (overrides: Partial<AnnotationElement> = {}): AnnotationElement => ({
  id: 'e1',
  type: 'marker',
  points: [{ x: 0, y: 0 }],
  color: 0xff0d4f8b,
  strokeWidth: 3,
  text: null,
  fontSize: null,
  opacity: 1,
  ...overrides,
});

interface Options {
  tool?: AnnotationTool;
  readOnly?: boolean;
  snap?: boolean;
  elements?: AnnotationElement[];
  selectedIds?: string[];
}

const renderCanvas = async ({
  tool = 'line',
  readOnly = false,
  snap = false,
  elements = [],
  selectedIds = [],
}: Options = {}) => {
  const handlers = {
    onDraw: jest.fn(),
    onErase: jest.fn(),
    onSelect: jest.fn(),
    onMove: jest.fn(),
  };
  await render(
    <GestureHandlerRootView>
      <PlanCanvas
        elements={elements}
        selectedIds={selectedIds}
        tool={tool}
        color={ANNOTATION_DEFAULTS.color}
        size={strokeSizeById(ANNOTATION_DEFAULTS.size)}
        snap={snap}
        readOnly={readOnly}
        {...handlers}
      />
    </GestureHandlerRootView>,
  );
  await act(async () => {
    fireEvent(screen.getByTestId('plan-canvas-area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, ...AREA } },
    });
  });
  return handlers;
};

type ScreenPoint = { x: number; y: number };

const drag = async (from: ScreenPoint, to: ScreenPoint) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  await act(async () => {
    fireGestureHandler(getByGestureTestId('plan-canvas-draw'), [
      { x: from.x, y: from.y, translationX: 0, translationY: 0 },
      { x: from.x + dx / 2, y: from.y + dy / 2, translationX: dx / 2, translationY: dy / 2 },
      { x: to.x, y: to.y, translationX: dx, translationY: dy },
      { x: to.x, y: to.y, translationX: dx, translationY: dy },
    ]);
  });
};

const tap = async (x: number, y: number) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId('plan-canvas-tap'), [
      { x, y },
      { x, y },
    ]);
  });
};

describe('PlanCanvas', () => {
  it('monta con Skia al conocer su tamaño y anuncia los elementos y la escala', async () => {
    await renderCanvas({ elements: [element()] });

    expect(screen.getByTestId('plan-canvas')).toHaveAccessibleName(
      'Plano, 1 elemento. Pellizca para acercar o alejar.',
    );
    // Al abrir encuadra el contenido: el marcador (Ø 17 px a 0,6 px/cm ≈ 28 cm)
    // llena el alto → 8,3 px/cm → la barra mide 10 cm.
    expect(screen.getByLabelText('Escala: la barra mide 10 cm')).toBeOnTheScreen();
  });

  it('un plano vacío empieza a 0,6 px/cm: la barra mide 1 m', async () => {
    await renderCanvas();
    expect(screen.getByLabelText('Escala: la barra mide 1 m')).toBeOnTheScreen();
  });

  it('en solo lectura lo anuncia y un dedo no dibuja', async () => {
    const { onDraw } = await renderCanvas({ readOnly: true });

    expect(screen.getByTestId('plan-canvas')).toHaveAccessibleName(
      'Plano de solo lectura, 0 elementos. Pellizca para acercar o alejar.',
    );
    await drag({ x: 200, y: 150 }, { x: 320, y: 150 });
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('una línea entrega sus extremos en centímetros del plano y la escala', async () => {
    const { onDraw } = await renderCanvas({ tool: 'line' });

    await drag({ x: 200, y: 150 }, { x: 320, y: 210 });

    expect(onDraw).toHaveBeenCalledWith({
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 100 },
      ],
      scale: 0.6,
    });
  });

  it('con el ajuste activo la línea se ajusta a la cuadrícula y a 15°', async () => {
    const { onDraw } = await renderCanvas({ tool: 'line', snap: true });

    // Inicio cerca del origen y final casi horizontal a ~2 m.
    await drag({ x: 203, y: 151 }, { x: 321, y: 153 });

    expect(onDraw).toHaveBeenCalledWith({
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      scale: 0.6,
    });
  });

  it('un toque con el marcador entrega el punto ajustado a la cuadrícula', async () => {
    const { onDraw } = await renderCanvas({ tool: 'marker', snap: true });

    // (236, 162) px = (60, 20) cm → cuadrícula de 50 cm → (50, 0).
    await tap(236, 162);

    expect(onDraw).toHaveBeenCalledWith({ points: [{ x: 50, y: 0 }], scale: 0.6 });
  });

  it('el borrador borra lo que toca', async () => {
    const { onErase, onDraw } = await renderCanvas({ tool: 'eraser', elements: [element()] });

    await tap(202, 151);

    expect(onErase).toHaveBeenCalledWith(['e1']);
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('seleccionar: un toque elige el elemento y otro en vacío quita la selección', async () => {
    const { onSelect } = await renderCanvas({ tool: 'select', elements: [element()] });

    await tap(201, 150);
    expect(onSelect).toHaveBeenLastCalledWith(['e1']);

    await tap(380, 280);
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  it('arrastrar lo seleccionado lo mueve en centímetros', async () => {
    const { onMove } = await renderCanvas({
      tool: 'select',
      elements: [element()],
      selectedIds: ['e1'],
    });

    await drag({ x: 200, y: 150 }, { x: 260, y: 180 });

    // Encuadre del marcador solo: (300 − 2 × 32) px / (2 × 8,5 / 0,6) cm.
    const scale = (AREA.height - 64) / ((8.5 / 0.6) * 2);
    expect(onMove).toHaveBeenCalledWith(
      ['e1'],
      expect.closeTo(60 / scale),
      expect.closeTo(30 / scale),
    );
  });

  it('arrastrar en vacío selecciona lo que queda dentro del rectángulo', async () => {
    const inside = element({ id: 'dentro', points: [{ x: 0, y: 0 }] });
    const outside = element({ id: 'fuera', points: [{ x: 1000, y: 0 }] });
    const { onSelect } = await renderCanvas({ tool: 'select', elements: [inside, outside] });

    // Encuadre: "dentro" queda a la izquierda (x ≈ 37 px) y "fuera" a la derecha (x ≈ 363 px).
    await drag({ x: 10, y: 120 }, { x: 100, y: 180 });

    expect(onSelect).toHaveBeenLastCalledWith(['dentro']);
  });

  it('acercar y alejar cambian la barra de escala', async () => {
    await renderCanvas();

    await act(async () => fireEvent.press(screen.getByTestId('plan-zoom-in')));
    expect(screen.getByLabelText('Escala: la barra mide 50 cm')).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByTestId('plan-zoom-out')));
    await act(async () => fireEvent.press(screen.getByTestId('plan-zoom-out')));
    // 0,6 × 1,6 ÷ 1,6 ÷ 1,6 = 0,375 px/cm → 2 m son 75 px.
    expect(screen.getByLabelText('Escala: la barra mide 2 m')).toBeOnTheScreen();
  });

  it('"Ver todo el plano" encuadra el contenido', async () => {
    const far = element({
      id: 'lejos',
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
      ],
    });
    await renderCanvas({ elements: [far] });

    await act(async () => fireEvent.press(screen.getByTestId('plan-zoom-fit')));
    // 100 m en 336 px → 0,0336 px/cm → la barra mide 20 m (67 px).
    expect(screen.getByLabelText('Escala: la barra mide 20 m')).toBeOnTheScreen();
  });
});

describe('measureLabel', () => {
  const draft = (type: AnnotationElement['type'], end: ScreenPoint) =>
    element({ type, points: [{ x: 0, y: 0 }, end] });

  it('mide líneas, cotas, rectángulos y círculos', () => {
    expect(measureLabel(draft('line', { x: 300, y: 400 }), null)).toBe('5 m');
    expect(measureLabel(draft('dimension', { x: 35, y: 0 }), null)).toBe('35 cm');
    expect(measureLabel(draft('rectangle', { x: 250, y: -120 }), null)).toBe('2,5 m × 1,2 m');
    expect(measureLabel(draft('circle', { x: 0, y: 80 }), null)).toBe('Radio 80 cm');
  });

  it('muestra cuánto se mueve la selección', () => {
    expect(measureLabel(null, { ids: new Set(['e1']), dx: 60, dy: 80 })).toBe('Mover 1 m');
  });

  it('no muestra nada sin dibujo o con elementos de un punto', () => {
    expect(measureLabel(null, null)).toBeNull();
    expect(measureLabel(element(), null)).toBeNull();
    expect(measureLabel(draft('freeStroke', { x: 1, y: 1 }), null)).toBeNull();
  });
});
