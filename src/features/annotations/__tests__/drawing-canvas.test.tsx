/**
 * @jest-environment ./jest.skia-environment.js
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import type { AnnotationElement, AnnotationTool } from '@/models/annotation.model';

import { ANNOTATION_DEFAULTS, strokeSizeById } from '../constants';
import { DrawingCanvas } from '../components/DrawingCanvas';

const element = (overrides: Partial<AnnotationElement> = {}): AnnotationElement => ({
  id: 'e1',
  type: 'freeStroke',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.5 },
    { x: 0.9, y: 0.2 },
  ],
  color: 0xff0d4f8b,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
  ...overrides,
});

const ELEMENTS: AnnotationElement[] = [
  element(),
  element({
    id: 'e2',
    type: 'arrow',
    points: [
      { x: 0.2, y: 0.8 },
      { x: 0.8, y: 0.8 },
    ],
  }),
  element({
    id: 'e3',
    type: 'circle',
    points: [
      { x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.5 },
    ],
  }),
  element({ id: 'e4', type: 'marker', points: [{ x: 0.3, y: 0.3 }] }),
  element({ id: 'e5', type: 'text', points: [{ x: 0.4, y: 0.4 }], text: 'Rack', fontSize: 18 }),
];

const renderCanvas = async ({
  readOnly = false,
  tool = ANNOTATION_DEFAULTS.tool,
}: { readOnly?: boolean; tool?: AnnotationTool } = {}) => {
  const onDraw = jest.fn();
  const onErase = jest.fn();
  await render(
    <GestureHandlerRootView>
      <DrawingCanvas
        elements={ELEMENTS}
        reference={{ width: 400, height: 300 }}
        tool={tool}
        color={ANNOTATION_DEFAULTS.color}
        size={strokeSizeById(ANNOTATION_DEFAULTS.size)}
        readOnly={readOnly}
        onDraw={onDraw}
        onErase={onErase}
      />
    </GestureHandlerRootView>,
  );
  return { onDraw, onErase };
};

const layout = (width: number, height: number) =>
  fireEvent(screen.getByTestId('drawing-canvas-area'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height } },
  });

describe('DrawingCanvas', () => {
  it('monta con el simulador de Skia y muestra el lienzo al conocer su tamaño', async () => {
    await renderCanvas();
    expect(screen.queryByTestId('drawing-canvas')).toBeNull();

    await layout(800, 800);

    const canvas = screen.getByTestId('drawing-canvas');
    expect(canvas).toHaveAccessibleName('Lienzo de anotaciones, 5 elementos');
    // Proporción 4:3 de la referencia, centrado en un área cuadrada.
    expect(canvas).toHaveStyle({ width: 800, height: 600, top: 100, left: 0 });
  });

  it('en solo lectura lo anuncia', async () => {
    await renderCanvas({ readOnly: true });
    await layout(400, 300);

    expect(screen.getByTestId('drawing-canvas')).toHaveAccessibleName(
      'Lienzo de anotaciones de solo lectura, 5 elementos',
    );
  });

  it('un toque con el marcador entrega el punto en píxeles del canvas', async () => {
    const { onDraw } = await renderCanvas({ tool: 'marker' });
    await layout(400, 300);

    await act(async () => {
      fireGestureHandler(getByGestureTestId('drawing-canvas-tap'), [
        { x: 100, y: 50 },
        { x: 100, y: 50 },
      ]);
    });

    expect(onDraw).toHaveBeenCalledWith({
      points: [{ x: 100, y: 50 }],
      canvasSize: { width: 400, height: 300 },
    });
  });

  it('un toque con el borrador sobre un elemento lo borra', async () => {
    const { onErase, onDraw } = await renderCanvas({ tool: 'eraser' });
    await layout(400, 300);

    // El marcador e4 está en (0.3, 0.3) → (120, 90) px.
    await act(async () => {
      fireGestureHandler(getByGestureTestId('drawing-canvas-tap'), [
        { x: 121, y: 91 },
        { x: 121, y: 91 },
      ]);
    });

    expect(onErase).toHaveBeenCalledWith(['e4']);
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('un arrastre con la línea entrega el punto inicial y el final', async () => {
    const { onDraw } = await renderCanvas({ tool: 'line' });
    await layout(400, 300);

    await act(async () => {
      fireGestureHandler(getByGestureTestId('drawing-canvas-pan'), [
        { x: 20, y: 20, translationX: 0, translationY: 0 },
        { x: 60, y: 40, translationX: 40, translationY: 20 },
        { x: 200, y: 100, translationX: 180, translationY: 80 },
        { x: 200, y: 100, translationX: 180, translationY: 80 },
      ]);
    });

    expect(onDraw).toHaveBeenCalledWith({
      points: [
        { x: 20, y: 20 },
        { x: 200, y: 100 },
      ],
      canvasSize: { width: 400, height: 300 },
    });
  });
});
