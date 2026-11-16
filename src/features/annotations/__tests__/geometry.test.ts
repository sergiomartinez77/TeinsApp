import type { AnnotationElement } from '@/models/annotation.model';

import {
  arrowHead,
  arrowPath,
  circleGeometry,
  circlePath,
  denormalizePoint,
  distance,
  elementDrawing,
  findElementAt,
  fitCanvas,
  freeStrokePath,
  gridPath,
  hitTestElement,
  linePath,
  normalizePoint,
  rectanglePath,
  strokeScale,
} from '../services/geometry';

const SIZE = { width: 400, height: 200 };

const element = (overrides: Partial<AnnotationElement> = {}): AnnotationElement => ({
  id: 'e1',
  type: 'line',
  points: [
    { x: 0.25, y: 0.5 },
    { x: 0.75, y: 0.5 },
  ],
  color: 0xff1a1a2e,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
  ...overrides,
});

describe('fitCanvas', () => {
  it('en un área más ancha que la referencia deja franjas a los lados', () => {
    expect(fitCanvas({ width: 400, height: 300 }, { width: 200, height: 200 })).toEqual({
      width: 300,
      height: 300,
      offsetX: 50,
      offsetY: 0,
    });
  });

  it('en un área más alta deja franjas arriba y abajo', () => {
    expect(fitCanvas({ width: 300, height: 500 }, { width: 600, height: 400 })).toEqual({
      width: 300,
      height: 200,
      offsetX: 0,
      offsetY: 150,
    });
  });

  it('con la misma proporción ocupa toda el área', () => {
    expect(fitCanvas({ width: 800, height: 600 }, { width: 400, height: 300 })).toEqual({
      width: 800,
      height: 600,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('sin referencia ocupa toda el área', () => {
    expect(fitCanvas({ width: 360, height: 500 }, null)).toEqual({
      width: 360,
      height: 500,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('un área sin medir da un canvas vacío', () => {
    expect(fitCanvas({ width: 0, height: 0 }, { width: 10, height: 10 })).toMatchObject({
      width: 0,
      height: 0,
    });
  });
});

describe('normalizar y desnormalizar', () => {
  it('son operaciones inversas', () => {
    const pixel = { x: 123, y: 45 };
    const normalized = normalizePoint(pixel, SIZE);

    expect(normalized).toEqual({ x: 0.3075, y: 0.225 });
    const back = denormalizePoint(normalized, SIZE);
    expect(back.x).toBeCloseTo(pixel.x);
    expect(back.y).toBeCloseTo(pixel.y);
  });

  it('recorta los puntos fuera del canvas', () => {
    expect(normalizePoint({ x: -10, y: 500 }, SIZE)).toEqual({ x: 0, y: 1 });
  });
});

describe('strokeScale', () => {
  it('es el ancho actual entre el de referencia', () => {
    expect(strokeScale(800, 400)).toBe(2);
    expect(strokeScale(200, 400)).toBe(0.5);
  });

  it('sin referencia no escala', () => {
    expect(strokeScale(800, null)).toBe(1);
    expect(strokeScale(800, 0)).toBe(1);
  });
});

describe('trazados SVG', () => {
  it('lápiz: curvas cuadráticas por los puntos medios', () => {
    const path = freeStrokePath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
    ]);

    expect(path).toBe('M 0 0 Q 10 10 15 5 Q 20 0 25 5 L 30 10');
  });

  it('lápiz: un solo punto dibuja un punto y dos una recta', () => {
    expect(freeStrokePath([{ x: 5, y: 5 }])).toMatch(/^M 5 5 L 5\.01 5$/);
    expect(
      freeStrokePath([
        { x: 0, y: 0 },
        { x: 4, y: 3 },
      ]),
    ).toBe('M 0 0 L 4 3');
    expect(freeStrokePath([])).toBe('');
  });

  it('línea: del punto inicial al final', () => {
    expect(linePath({ x: 1, y: 2 }, { x: 3.456, y: 4 })).toBe('M 1 2 L 3.46 4');
  });

  it('flecha: la punta está en el extremo final', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const [left, right] = arrowHead(start, end, 4);

    // Las alas quedan detrás del extremo, una a cada lado.
    expect(left.x).toBeLessThan(100);
    expect(right.x).toBeLessThan(100);
    expect(Math.sign(left.y)).toBe(-Math.sign(right.y));
    expect(distance(left, end)).toBeCloseTo(16);
    expect(arrowPath(start, end, 4)).toMatch(/^M 0 0 L 100 0 M [\d.]+ -?[\d.]+ L 100 0 L /);
  });

  it('flecha: la punta crece con el grosor y tiene un mínimo', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };

    expect(distance(arrowHead(start, end, 1)[0], end)).toBeCloseTo(12);
    expect(distance(arrowHead(start, end, 8)[0], end)).toBeCloseTo(32);
  });

  it('rectángulo: cuatro esquinas a partir de dos opuestas, en cualquier orden', () => {
    expect(rectanglePath({ x: 30, y: 40 }, { x: 10, y: 20 })).toBe(
      'M 10 20 L 30 20 L 30 40 L 10 40 Z',
    );
  });

  it('círculo: el radio es la distancia en píxeles del centro al borde', () => {
    expect(circleGeometry({ x: 50, y: 50 }, { x: 53, y: 54 })).toEqual({ cx: 50, cy: 50, r: 5 });
    expect(circlePath({ x: 50, y: 50 }, { x: 53, y: 54 })).toBe(
      'M 45 50 A 5 5 0 1 0 55 50 A 5 5 0 1 0 45 50 Z',
    );
  });

  it('círculo: en un canvas no cuadrado sigue siendo un círculo real', () => {
    const drawing = elementDrawing(
      element({
        type: 'circle',
        points: [
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.6 },
        ],
      }),
      SIZE,
      1,
    );

    // 0.1 del alto (200 px) = 20 px de radio.
    expect(drawing).toMatchObject({
      kind: 'stroke',
      path: 'M 180 100 A 20 20 0 1 0 220 100 A 20 20 0 1 0 180 100 Z',
    });
  });

  it('cuadrícula: celdas cuadradas con el número de columnas pedido', () => {
    const path = gridPath({ width: 100, height: 50 }, 4);

    expect(path.match(/M [\d.]+ 0 L/g)).toHaveLength(3);
    expect(path.match(/M 0 [\d.]+ L/g)).toHaveLength(1);
  });
});

describe('elementDrawing', () => {
  it('multiplica el grosor por la escala', () => {
    expect(elementDrawing(element(), SIZE, 2)).toMatchObject({
      kind: 'stroke',
      path: 'M 100 100 L 300 100',
      strokeWidth: 8,
      color: 'rgba(26, 26, 46, 1)',
    });
  });

  it('texto: tamaño escalado y línea base bajo el punto', () => {
    const drawing = elementDrawing(
      element({ type: 'text', points: [{ x: 0.5, y: 0.5 }], text: 'UPS', fontSize: 20 }),
      SIZE,
      0.5,
    );

    expect(drawing).toMatchObject({ kind: 'text', x: 200, fontSize: 10, text: 'UPS' });
    expect(drawing?.kind === 'text' && drawing.y).toBeCloseTo(103.5);
  });

  it('marcador: círculo relleno con borde', () => {
    expect(
      elementDrawing(element({ type: 'marker', points: [{ x: 0.5, y: 0.5 }] }), SIZE, 1),
    ).toMatchObject({ kind: 'marker', cx: 200, cy: 100, r: 10 });
  });
});

describe('detección de toque', () => {
  it('línea: dentro y fuera de la tolerancia', () => {
    const line = element();

    // Tolerancia: 16 px + mitad del grosor (2 px).
    expect(hitTestElement(line, { x: 200, y: 117 }, SIZE, 1)).toBe(true);
    expect(hitTestElement(line, { x: 200, y: 119 }, SIZE, 1)).toBe(false);
    expect(hitTestElement(line, { x: 330, y: 100 }, SIZE, 1)).toBe(false);
  });

  it('lápiz: cerca de cualquier tramo', () => {
    const stroke = element({
      type: 'freeStroke',
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
    });

    expect(hitTestElement(stroke, { x: 210, y: 150 }, SIZE, 1)).toBe(true);
    expect(hitTestElement(stroke, { x: 100, y: 150 }, SIZE, 1)).toBe(false);
  });

  it('lápiz de un solo punto: cerca del punto', () => {
    const dot = element({ type: 'freeStroke', points: [{ x: 0.5, y: 0.5 }] });

    expect(hitTestElement(dot, { x: 210, y: 105 }, SIZE, 1)).toBe(true);
    expect(hitTestElement(dot, { x: 240, y: 100 }, SIZE, 1)).toBe(false);
  });

  it('rectángulo: solo en el borde, no en el interior', () => {
    const rectangle = element({
      type: 'rectangle',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });

    expect(hitTestElement(rectangle, { x: 5, y: 100 }, SIZE, 1)).toBe(true);
    expect(hitTestElement(rectangle, { x: 200, y: 190 }, SIZE, 1)).toBe(true);
    expect(hitTestElement(rectangle, { x: 200, y: 100 }, SIZE, 1)).toBe(false);
  });

  it('círculo: solo cerca de la circunferencia', () => {
    const circle = element({
      type: 'circle',
      points: [
        { x: 0.5, y: 0.5 },
        { x: 0.75, y: 0.5 },
      ],
    });

    expect(hitTestElement(circle, { x: 300, y: 100 }, SIZE, 1)).toBe(true);
    expect(hitTestElement(circle, { x: 200, y: 100 }, SIZE, 1)).toBe(false);
    expect(hitTestElement(circle, { x: 340, y: 100 }, SIZE, 1)).toBe(false);
  });

  it('marcador: dentro del radio más la tolerancia', () => {
    const marker = element({ type: 'marker', points: [{ x: 0.5, y: 0.5 }] });

    expect(hitTestElement(marker, { x: 225, y: 100 }, SIZE, 1)).toBe(true);
    expect(hitTestElement(marker, { x: 228, y: 100 }, SIZE, 1)).toBe(false);
  });

  it('texto: dentro de la caja que ocupa el texto', () => {
    const text = element({
      type: 'text',
      points: [{ x: 0.25, y: 0.5 }],
      text: 'Tablero',
      fontSize: 20,
    });

    expect(hitTestElement(text, { x: 150, y: 100 }, SIZE, 1)).toBe(true);
    expect(hitTestElement(text, { x: 300, y: 100 }, SIZE, 1)).toBe(false);
  });

  it('findElementAt devuelve el elemento de más arriba o null', () => {
    const below = element({ id: 'abajo' });
    const above = element({ id: 'arriba' });

    expect(findElementAt([below, above], { x: 200, y: 100 }, SIZE, 1)).toBe('arriba');
    expect(findElementAt([below, above], { x: 200, y: 10 }, SIZE, 1)).toBeNull();
  });
});
