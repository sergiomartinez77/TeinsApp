import { argbToCss, type AnnotationElement } from '@/models/annotation.model';

import { PLAN_ZOOM } from '../constants';
import {
  appendPoint,
  arrowHead,
  arrowPath,
  boundsFromCorners,
  boundsOfPoints,
  circleGeometry,
  circlePath,
  clampScale,
  containsBounds,
  containsPoint,
  contentBounds,
  dimensionLabel,
  dimensionPath,
  distance,
  distanceToSegment,
  elementBounds,
  elementDrawing,
  elementsInside,
  findElementAt,
  fitViewport,
  formatLength,
  freeStrokePath,
  gridSpacing,
  hitTestElement,
  linePath,
  markerRadius,
  rectanglePath,
  scaleBar,
  screenToWorld,
  snapSegmentEnd,
  snapToGrid,
  translateElement,
  unionBounds,
  viewCenter,
  worldToScreen,
  zoomAround,
  type Point,
} from '../services/geometry';

/** Elemento en centímetros (formato 2). */
const element = (overrides: Partial<AnnotationElement> = {}): AnnotationElement => ({
  id: 'e1',
  type: 'line',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  color: 0xff1a1a2e,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
  ...overrides,
});

const AREA = { width: 400, height: 300 };

const expectPoint = (actual: Point, expected: Point) => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
};

// ── Vista ────────────────────────────────────────────────────────────────────

describe('vista', () => {
  it('clampScale limita el zoom y corrige escalas no válidas', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(1000)).toBe(PLAN_ZOOM.max);
    expect(clampScale(0.0001)).toBe(PLAN_ZOOM.min);
    expect(clampScale(0)).toBe(PLAN_ZOOM.initial);
    expect(clampScale(-2)).toBe(PLAN_ZOOM.initial);
    expect(clampScale(Number.NaN)).toBe(PLAN_ZOOM.initial);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(PLAN_ZOOM.initial);
  });

  it('screenToWorld y worldToScreen son inversas', () => {
    const view = { scale: 2, tx: 10, ty: -20 };

    expect(worldToScreen({ x: 5, y: 5 }, view)).toEqual({ x: 20, y: -10 });
    expect(screenToWorld({ x: 20, y: -10 }, view)).toEqual({ x: 5, y: 5 });
    const point = { x: -123.4, y: 987.6 };
    expectPoint(screenToWorld(worldToScreen(point, view), view), point);
  });

  it('zoomAround mantiene fijo el punto de pantalla del foco', () => {
    const view = { scale: 1, tx: 0, ty: 0 };
    const focal = { x: 100, y: 50 };

    const zoomed = zoomAround(view, focal, 2);

    expect(zoomed).toEqual({ scale: 2, tx: -100, ty: -50 });
    expectPoint(screenToWorld(focal, zoomed), screenToWorld(focal, view));
  });

  it('zoomAround respeta los límites del zoom sin mover el foco', () => {
    const view = { scale: 3, tx: 40, ty: -15 };
    const focal = { x: 220, y: 130 };
    const before = screenToWorld(focal, view);

    const zoomedIn = zoomAround(view, focal, 1000);
    const zoomedOut = zoomAround(view, focal, 1e-9);

    expect(zoomedIn.scale).toBe(PLAN_ZOOM.max);
    expect(zoomedOut.scale).toBe(PLAN_ZOOM.min);
    expectPoint(screenToWorld(focal, zoomedIn), before);
    expectPoint(screenToWorld(focal, zoomedOut), before);
  });

  it('viewCenter da el centro de la pantalla en centímetros', () => {
    expect(viewCenter({ scale: 2, tx: 0, ty: 0 }, AREA)).toEqual({ x: 100, y: 75 });
    expect(viewCenter({ scale: 1, tx: 200, ty: 150 }, AREA)).toEqual({ x: 0, y: 0 });
  });

  it('fitViewport sin contenido usa el zoom inicial con el origen en el centro', () => {
    expect(fitViewport(null, AREA)).toEqual({ scale: PLAN_ZOOM.initial, tx: 200, ty: 150 });
    // Con un área vacía (aún sin medir) tampoco encuadra.
    expect(fitViewport({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 0 })).toEqual({
      scale: PLAN_ZOOM.initial,
      tx: 0,
      ty: 0,
    });
  });

  it('fitViewport encuadra el contenido con margen y lo centra', () => {
    const view = fitViewport({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, AREA);

    // Margen de 32 px: (400 − 64) / 1000 = 0,336 limita más que (300 − 64) / 500.
    expect(view.scale).toBeCloseTo(0.336, 10);
    expectPoint(worldToScreen({ x: 500, y: 250 }, view), { x: 200, y: 150 });
    expectPoint(worldToScreen({ x: 0, y: 0 }, view), { x: 32, y: 66 });
  });

  it('fitViewport con un solo punto lo centra con el zoom inicial', () => {
    const view = fitViewport({ minX: 50, minY: 50, maxX: 50, maxY: 50 }, AREA);

    expect(view.scale).toBe(PLAN_ZOOM.initial);
    expectPoint(worldToScreen({ x: 50, y: 50 }, view), { x: 200, y: 150 });
  });

  it('fitViewport con una línea recta encuadra solo su dirección', () => {
    const view = fitViewport({ minX: 0, minY: 0, maxX: 1000, maxY: 0 }, AREA);

    expect(view.scale).toBeCloseTo(0.336, 10);
  });

  it('fitViewport con contenido diminuto no pasa del zoom máximo', () => {
    expect(fitViewport({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, AREA).scale).toBe(PLAN_ZOOM.max);
  });
});

// ── Cuadrícula y escala ──────────────────────────────────────────────────────

describe('gridSpacing', () => {
  it('elige el paso más pequeño que deja al menos 14 px', () => {
    // 1 m = 60 px: 10 cm son 6 px (poco) y 50 cm, 30 px.
    expect(gridSpacing(PLAN_ZOOM.initial)).toEqual({ minor: 50, major: 100 });
    expect(gridSpacing(PLAN_ZOOM.max)).toEqual({ minor: 1, major: 5 });
    expect(gridSpacing(PLAN_ZOOM.min)).toEqual({ minor: 5000, major: 10000 });
    expect(gridSpacing(14)).toEqual({ minor: 1, major: 5 });
    expect(gridSpacing(13.9)).toEqual({ minor: 5, major: 10 });
  });

  it('más allá del último paso usa 1 km y la marcada, 10 km', () => {
    expect(gridSpacing(0.0001)).toEqual({ minor: 100000, major: 1000000 });
  });
});

describe('scaleBar', () => {
  it('elige la longitud redonda más larga que cabe en ~90 px', () => {
    expect(scaleBar(PLAN_ZOOM.initial)).toEqual({ lengthCm: 100, widthPx: 60, label: '1 m' });
    expect(scaleBar(PLAN_ZOOM.max)).toEqual({ lengthCm: 2, widthPx: 50, label: '2 cm' });
    expect(scaleBar(PLAN_ZOOM.min)).toEqual({ lengthCm: 10000, widthPx: 50, label: '100 m' });
    expect(scaleBar(1.8)).toEqual({ lengthCm: 50, widthPx: 90, label: '50 cm' });
  });

  it('acepta otra longitud objetivo', () => {
    expect(scaleBar(1, 30)).toEqual({ lengthCm: 20, widthPx: 20, label: '20 cm' });
  });

  it('si ni 1 cm cabe, muestra 1 cm igualmente', () => {
    expect(scaleBar(100, 90)).toEqual({ lengthCm: 1, widthPx: 100, label: '1 cm' });
  });
});

describe('formatLength', () => {
  it('elige la unidad con el valor ya redondeado', () => {
    expect(formatLength(0.97)).toBe('1 cm');
    expect(formatLength(99.6)).toBe('1 m');
    expect(formatLength(99999.9)).toBe('1 km');
  });

  it('milímetros por debajo de 1 cm', () => {
    expect(formatLength(0.5)).toBe('5 mm');
    expect(formatLength(0)).toBe('0 mm');
  });

  it('centímetros por debajo de 1 m (un decimal hasta 10 cm)', () => {
    expect(formatLength(5)).toBe('5 cm');
    expect(formatLength(2.5)).toBe('2,5 cm');
    expect(formatLength(35)).toBe('35 cm');
    // Sin decimales no se recortan los ceros de las decenas.
    expect(formatLength(50)).toBe('50 cm');
    expect(formatLength(10)).toBe('10 cm');
  });

  it('metros con hasta dos decimales y coma', () => {
    expect(formatLength(100)).toBe('1 m');
    expect(formatLength(150)).toBe('1,5 m');
    expect(formatLength(235)).toBe('2,35 m');
    expect(formatLength(1000)).toBe('10 m');
    expect(formatLength(10000)).toBe('100 m');
  });

  it('kilómetros a partir de 1 km', () => {
    expect(formatLength(100000)).toBe('1 km');
    expect(formatLength(120000)).toBe('1,2 km');
  });

  it('las longitudes negativas se muestran en positivo', () => {
    expect(formatLength(-35)).toBe('35 cm');
  });
});

// ── Ajuste ───────────────────────────────────────────────────────────────────

describe('snapToGrid', () => {
  it('lleva el punto a la intersección más cercana', () => {
    expect(snapToGrid({ x: 12, y: -7 }, 5)).toEqual({ x: 10, y: -5 });
    expect(snapToGrid({ x: 74, y: 76 }, 50)).toEqual({ x: 50, y: 100 });
  });

  it('con un paso no válido no cambia el punto', () => {
    const point = { x: 1.3, y: 2.7 };
    expect(snapToGrid(point, 0)).toBe(point);
    expect(snapToGrid(point, -5)).toBe(point);
  });
});

describe('snapSegmentEnd', () => {
  const start = { x: 0, y: 0 };

  it('ajusta el ángulo a múltiplos de 15° y redondea la longitud al paso', () => {
    // ~5,8° → 0°; longitud ~98,5 → 100.
    expect(snapSegmentEnd(start, { x: 98, y: 10 }, 10)).toEqual({ x: 100, y: 0 });
    // ~45,8° → 45°; longitud ~100,4 → 100.
    expect(snapSegmentEnd(start, { x: 70, y: 72 }, 10)).toEqual({ x: 70.711, y: 70.711 });
    // Hacia arriba a la izquierda: −90°.
    expect(snapSegmentEnd({ x: 10, y: 10 }, { x: 12, y: -38 }, 10)).toEqual({ x: 10, y: -40 });
  });

  it('la longitud mínima es un paso', () => {
    expect(snapSegmentEnd(start, { x: 2, y: 0 }, 10)).toEqual({ x: 10, y: 0 });
  });

  it('sin paso solo ajusta el ángulo', () => {
    // 53,13° → 60°, longitud 5.
    expect(snapSegmentEnd(start, { x: 3, y: 4 }, 0)).toEqual({ x: 2.5, y: 4.33 });
  });

  it('acepta otro ángulo de ajuste', () => {
    expect(snapSegmentEnd(start, { x: 3, y: 4 }, 0, 90)).toEqual({ x: 0, y: 5 });
  });

  it('un segmento de longitud cero no cambia', () => {
    const end = { x: 0, y: 0 };
    expect(snapSegmentEnd(start, end, 10)).toBe(end);
  });
});

// ── Puntos y límites ─────────────────────────────────────────────────────────

describe('puntos', () => {
  it('distance y distanceToSegment', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBe(3);
    // Fuera del segmento: distancia al extremo más cercano.
    expect(distanceToSegment({ x: 13, y: 4 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: -3, y: 4 }, a, b)).toBe(5);
    // Segmento de longitud cero.
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
  });

  it('appendPoint descarta los puntos demasiado cercanos', () => {
    const points = appendPoint([], { x: 0, y: 0 });
    expect(points).toEqual([{ x: 0, y: 0 }]);
    expect(appendPoint(points, { x: 1, y: 0 })).toBe(points);
    expect(appendPoint(points, { x: 1, y: 0 }, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(appendPoint(points, { x: 2, y: 0 })).toHaveLength(2);
  });

  it('boundsOfPoints, unionBounds y boundsFromCorners', () => {
    expect(boundsOfPoints([])).toBeNull();
    const bounds = boundsOfPoints([
      { x: 5, y: -2 },
      { x: -1, y: 8 },
      { x: 3, y: 3 },
    ]);
    expect(bounds).toEqual({ minX: -1, minY: -2, maxX: 5, maxY: 8 });
    const other = { minX: 0, minY: -10, maxX: 20, maxY: 0 };
    expect(unionBounds(bounds, other)).toEqual({ minX: -1, minY: -10, maxX: 20, maxY: 8 });
    expect(unionBounds(null, other)).toBe(other);
    expect(unionBounds(other, null)).toBe(other);
    expect(unionBounds(null, null)).toBeNull();
    expect(boundsFromCorners({ x: 10, y: 0 }, { x: 0, y: 5 })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 5,
    });
  });

  it('containsBounds y containsPoint (con margen)', () => {
    const outer = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(containsBounds(outer, { minX: 0, minY: 2, maxX: 10, maxY: 5 })).toBe(true);
    expect(containsBounds(outer, { minX: -1, minY: 2, maxX: 5, maxY: 5 })).toBe(false);
    expect(containsBounds(outer, { minX: 1, minY: 2, maxX: 5, maxY: 11 })).toBe(false);
    expect(containsPoint(outer, { x: 10, y: 10 })).toBe(true);
    expect(containsPoint(outer, { x: 12, y: 5 })).toBe(false);
    expect(containsPoint(outer, { x: 12, y: 5 }, 2)).toBe(true);
    expect(containsPoint(outer, { x: 5, y: -3 }, 2)).toBe(false);
  });

  it('markerRadius crece con el grosor', () => {
    expect(markerRadius(0)).toBe(4);
    expect(markerRadius(4)).toBe(10);
  });
});

describe('elementBounds', () => {
  it('línea, flecha, rectángulo y trazo libre: los puntos', () => {
    const points = [
      { x: 0, y: 50 },
      { x: 100, y: 0 },
    ];
    for (const type of ['line', 'arrow', 'rectangle'] as const) {
      expect(elementBounds(element({ type, points }), 1)).toEqual({
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 50,
      });
    }
    const stroke = element({
      type: 'freeStroke',
      points: [
        { x: 1, y: 1 },
        { x: -4, y: 9 },
        { x: 6, y: 3 },
      ],
    });
    expect(elementBounds(stroke, 1)).toEqual({ minX: -4, minY: 1, maxX: 6, maxY: 9 });
  });

  it('círculo: el centro más el radio', () => {
    const circle = element({
      type: 'circle',
      points: [
        { x: 10, y: 10 },
        { x: 13, y: 14 },
      ],
    });
    expect(elementBounds(circle, 1)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
  });

  it('texto: caja aproximada a la derecha del punto y a media altura', () => {
    const text = element({ type: 'text', points: [{ x: 10, y: 20 }], text: 'Rack', fontSize: 10 });
    expect(elementBounds(text, 1)).toEqual({ minX: 10, minY: 15, maxX: 32, maxY: 25 });

    // Sin tamaño guardado: 18 cm por defecto.
    const bounds = elementBounds({ ...text, fontSize: null }, 1);
    expect(bounds?.maxX).toBeCloseTo(10 + 4 * 18 * 0.55, 10);
    expect(bounds?.minY).toBe(11);
  });

  it('marcador: mide lo mismo en pantalla con cualquier zoom', () => {
    // Grosor 4 → radio de 10 px: 10 cm con escala 1 y 5 cm con escala 2.
    const marker = element({ type: 'marker', points: [{ x: 50, y: 50 }] });
    expect(elementBounds(marker, 1)).toEqual({ minX: 40, minY: 40, maxX: 60, maxY: 60 });
    expect(elementBounds(marker, 2)).toEqual({ minX: 45, minY: 45, maxX: 55, maxY: 55 });
  });

  it('cota: la línea más el texto con la longitud', () => {
    const dimension = element({ type: 'dimension', fontSize: 10 });

    // "1 m" (3 caracteres × 10 × 0,55 = 16,5 cm de ancho), centrado sobre la línea.
    expect(elementBounds(dimension, 1)).toEqual({ minX: 0, minY: -14, maxX: 100, maxY: 0 });
  });

  it('sin puntos no hay límites', () => {
    expect(elementBounds(element({ points: [] }), 1)).toBeNull();
  });

  it('contentBounds une todos los elementos', () => {
    expect(contentBounds([], 1)).toBeNull();
    const elements = [
      element({ id: 'a' }),
      element({ id: 'b', type: 'marker', points: [{ x: 0, y: 200 }] }),
      element({ id: 'c', points: [] }),
    ];
    expect(contentBounds(elements, 1)).toEqual({ minX: -10, minY: 0, maxX: 100, maxY: 210 });
  });

  it('elementsInside devuelve solo los elementos enteros dentro del área', () => {
    const elements = [
      element({
        id: 'dentro',
        points: [
          { x: 10, y: 10 },
          { x: 40, y: 40 },
        ],
      }),
      element({
        id: 'cortado',
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
        ],
      }),
      element({ id: 'vacio', points: [] }),
      element({ id: 'marca', type: 'marker', points: [{ x: 45, y: 45 }] }),
    ];
    const area = { minX: 0, minY: 0, maxX: 50, maxY: 50 };

    // El marcador (radio 10 px) cabe con escala 2 (5 cm) pero no con escala 1 (10 cm).
    expect(elementsInside(elements, area, 2)).toEqual(['dentro', 'marca']);
    expect(elementsInside(elements, area, 1)).toEqual(['dentro']);
  });
});

describe('translateElement', () => {
  it('desplaza todos los puntos y conserva el id', () => {
    const moved = translateElement(element(), 5, -3);
    expect(moved).toEqual(
      element({
        points: [
          { x: 5, y: -3 },
          { x: 105, y: -3 },
        ],
      }),
    );
  });

  it('con otro id crea una copia sin cambiar el original', () => {
    const original = element();
    const copy = translateElement(original, 1, 1, 'copia');
    expect(copy.id).toBe('copia');
    expect(original.points[0]).toEqual({ x: 0, y: 0 });
  });
});

// ── Trazados ─────────────────────────────────────────────────────────────────

describe('trazados SVG', () => {
  it('freeStrokePath suaviza con curvas por los puntos medios', () => {
    expect(freeStrokePath([])).toBe('');
    expect(freeStrokePath([{ x: 1, y: 2 }])).toBe('M 1 2 L 1.001 2');
    expect(
      freeStrokePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toBe('M 0 0 L 10 5');
    expect(
      freeStrokePath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ]),
    ).toBe('M 0 0 Q 10 10 15 5 L 20 0');
  });

  it('linePath, rectanglePath y circlePath', () => {
    expect(linePath({ x: 0, y: 0 }, { x: 1.23456, y: -2 })).toBe('M 0 0 L 1.235 -2');
    expect(rectanglePath({ x: 10, y: 10 }, { x: 0, y: 0 })).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    expect(circleGeometry({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ cx: 0, cy: 0, r: 5 });
    expect(circlePath({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(
      'M -5 0 A 5 5 0 1 0 5 0 A 5 5 0 1 0 -5 0 Z',
    );
  });

  it('arrowHead: dos alas a ±30° que nacen en el extremo', () => {
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 6);
    expectPoint(left, { x: 10 - 6 * Math.cos(Math.PI / 6), y: 3 });
    expectPoint(right, { x: 10 - 6 * Math.cos(Math.PI / 6), y: -3 });
  });

  it('arrowPath: la línea y la punta', () => {
    expect(arrowPath({ x: 0, y: 0 }, { x: 0, y: 10 }, 2)).toBe(
      'M 0 0 L 0 10 M -1 8.268 L 0 10 L 1 8.268',
    );
  });

  it('dimensionPath: la línea y una marca perpendicular en cada extremo', () => {
    expect(dimensionPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)).toBe(
      'M 0 0 L 100 0 M 0 -5 L 0 5 M 100 -5 L 100 5',
    );
    expect(dimensionPath({ x: 0, y: 0 }, { x: 0, y: 50 }, 4)).toBe(
      'M 0 0 L 0 50 M 2 0 L -2 0 M 2 50 L -2 50',
    );
    // Longitud cero: solo la línea (sin marcas sin dirección).
    expect(dimensionPath({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toBe('M 5 5 L 5 5');
  });

  it('dimensionLabel: la longitud centrada sobre la línea', () => {
    expect(dimensionLabel(element({ type: 'dimension', fontSize: 10 }))).toEqual({
      text: '1 m',
      fontSize: 10,
      anchor: { x: 41.75, y: -9 },
    });
    // Sin tamaño guardado: proporcional a la longitud (1/8), al menos 1 cm.
    expect(dimensionLabel(element({ type: 'dimension' }))?.fontSize).toBe(12.5);
    const short = element({
      type: 'dimension',
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
    });
    expect(dimensionLabel(short)).toMatchObject({ text: '4 cm', fontSize: 1 });
    expect(dimensionLabel(element({ type: 'dimension', points: [{ x: 0, y: 0 }] }))).toBeNull();
  });
});

describe('elementDrawing', () => {
  const css = argbToCss(0xff1a1a2e);

  it('trazo libre, línea, rectángulo y círculo: un trazo con el grosor en píxeles', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    expect(elementDrawing(element({ type: 'freeStroke', points, opacity: 0.5 }), 1)).toEqual({
      color: css,
      opacity: 0.5,
      parts: [{ kind: 'stroke', path: freeStrokePath(points), strokeWidth: 4 }],
    });
    const a = { x: 0, y: 0 };
    const b = { x: 30, y: 40 };
    const cases = [
      ['line', linePath(a, b)],
      ['rectangle', rectanglePath(a, b)],
      ['circle', circlePath(a, b)],
    ] as const;
    for (const [type, path] of cases) {
      // El grosor no cambia con la escala.
      for (const scale of [0.1, 3]) {
        expect(elementDrawing(element({ type, points: [a, b] }), scale)?.parts).toEqual([
          { kind: 'stroke', path, strokeWidth: 4 },
        ]);
      }
    }
  });

  it('flecha: la punta mide lo mismo en pantalla (px / escala)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const thin = element({ type: 'arrow', strokeWidth: 2 });
    // Punta mínima de 12 px: 6 cm con escala 2, 24 cm con escala 0,5.
    expect(elementDrawing(thin, 2)?.parts).toEqual([
      { kind: 'stroke', path: arrowPath(a, b, 6), strokeWidth: 2 },
    ]);
    expect(elementDrawing(thin, 0.5)?.parts).toEqual([
      { kind: 'stroke', path: arrowPath(a, b, 24), strokeWidth: 2 },
    ]);
    // Con grosor 5 la punta es de 20 px (4 × grosor).
    const thick = element({ type: 'arrow', strokeWidth: 5 });
    expect(elementDrawing(thick, 2)?.parts).toEqual([
      { kind: 'stroke', path: arrowPath(a, b, 10), strokeWidth: 5 },
    ]);
  });

  it('cota: el trazo con marcas (px / escala) y el texto con la longitud', () => {
    const dimension = element({ type: 'dimension', strokeWidth: 2, fontSize: 10 });

    // Marcas de 8 + 2 × 2 = 12 px: 6 cm con escala 2.
    expect(elementDrawing(dimension, 2)?.parts).toEqual([
      {
        kind: 'stroke',
        path: dimensionPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 6),
        strokeWidth: 2,
      },
      { kind: 'text', x: 41.75, y: -5.5, fontSize: 10, text: '1 m' },
    ]);
  });

  it('texto: línea base centrada sobre el punto', () => {
    const text = element({ type: 'text', points: [{ x: 10, y: 20 }], text: 'Rack', fontSize: 10 });
    expect(elementDrawing(text, 1)?.parts).toEqual([
      { kind: 'text', x: 10, y: 23.5, fontSize: 10, text: 'Rack' },
    ]);
    const parts = elementDrawing({ ...text, fontSize: null }, 1)?.parts;
    expect(parts?.[0]).toMatchObject({ kind: 'text', fontSize: 18 });
  });

  it('marcador: radio y borde en píxeles', () => {
    const marker = element({ type: 'marker', points: [{ x: 7, y: 8 }] });
    expect(elementDrawing(marker, 5)?.parts).toEqual([
      { kind: 'marker', cx: 7, cy: 8, r: 10, borderWidth: 2.5 },
    ]);
    const thin = element({ type: 'marker', points: [{ x: 7, y: 8 }], strokeWidth: 0 });
    expect(elementDrawing(thin, 1)?.parts).toEqual([
      { kind: 'marker', cx: 7, cy: 8, r: 4, borderWidth: 2 },
    ]);
  });

  it('lo que no se puede dibujar da null', () => {
    const single = [{ x: 0, y: 0 }];
    expect(elementDrawing(element({ points: [] }), 1)).toBeNull();
    for (const type of ['line', 'arrow', 'rectangle', 'circle', 'dimension'] as const) {
      expect(elementDrawing(element({ type, points: single }), 1)).toBeNull();
    }
    expect(elementDrawing(element({ type: 'text', points: single, text: null }), 1)).toBeNull();
  });
});

// ── Detección de toque ───────────────────────────────────────────────────────

describe('hitTestElement', () => {
  it('línea: tolerancia de 16 px más medio grosor, convertida con la escala', () => {
    // Grosor 4: alcance de 18 px → 18 cm con escala 1 y 9 cm con escala 2.
    const line = element();
    expect(hitTestElement(line, { x: 50, y: 17 }, 1)).toBe(true);
    expect(hitTestElement(line, { x: 50, y: 19 }, 1)).toBe(false);
    expect(hitTestElement(line, { x: 50, y: 17 }, 2)).toBe(false);
    expect(hitTestElement(line, { x: 50, y: 8 }, 2)).toBe(true);
    // Con otra tolerancia.
    expect(hitTestElement(line, { x: 50, y: 17 }, 1, 4)).toBe(false);
  });

  it('flecha y trazo libre siguen sus segmentos', () => {
    expect(hitTestElement(element({ type: 'arrow' }), { x: 110, y: 0 }, 1)).toBe(true);
    expect(hitTestElement(element({ type: 'arrow' }), { x: 120, y: 0 }, 1)).toBe(false);
    const stroke = element({
      type: 'freeStroke',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    });
    expect(hitTestElement(stroke, { x: 95, y: 50 }, 1)).toBe(true);
    expect(hitTestElement(stroke, { x: 50, y: 50 }, 1)).toBe(false);
    const dot = element({ type: 'freeStroke', points: [{ x: 0, y: 0 }] });
    expect(hitTestElement(dot, { x: 10, y: 0 }, 1)).toBe(true);
    expect(hitTestElement(dot, { x: 30, y: 0 }, 1)).toBe(false);
  });

  it('rectángulo y círculo: solo por el borde', () => {
    const rectangle = element({
      type: 'rectangle',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
    });
    expect(hitTestElement(rectangle, { x: 50, y: 5 }, 1)).toBe(true);
    expect(hitTestElement(rectangle, { x: 95, y: 50 }, 1)).toBe(true);
    expect(hitTestElement(rectangle, { x: 50, y: 50 }, 1)).toBe(false);

    const circle = element({ type: 'circle' });
    expect(hitTestElement(circle, { x: 95, y: 0 }, 1)).toBe(true);
    expect(hitTestElement(circle, { x: 0, y: -110 }, 1)).toBe(true);
    expect(hitTestElement(circle, { x: 0, y: 0 }, 1)).toBe(false);
    expect(hitTestElement(circle, { x: 0, y: -110 }, 4)).toBe(false);
  });

  it('texto: dentro de su caja con margen', () => {
    // Caja de 0 a 22 cm × −5 a 5 cm; margen de 16 px.
    const text = element({ type: 'text', points: [{ x: 0, y: 0 }], text: 'Rack', fontSize: 10 });
    expect(hitTestElement(text, { x: 11, y: 0 }, 1)).toBe(true);
    expect(hitTestElement(text, { x: 30, y: 0 }, 1)).toBe(true);
    expect(hitTestElement(text, { x: 40, y: 0 }, 1)).toBe(false);
    expect(hitTestElement(text, { x: 30, y: 0 }, 4)).toBe(false);
    const noSize = element({ type: 'text', points: [{ x: 0, y: 0 }], text: 'Rack' });
    expect(hitTestElement(noSize, { x: 30, y: 0 }, 4)).toBe(true);
  });

  it('marcador: su radio más la tolerancia, en píxeles', () => {
    // Grosor 4: radio de 10 px + 16 px = 26 px.
    const marker = element({ type: 'marker', points: [{ x: 0, y: 0 }] });
    expect(hitTestElement(marker, { x: 0, y: 25 }, 1)).toBe(true);
    expect(hitTestElement(marker, { x: 0, y: 27 }, 1)).toBe(false);
    expect(hitTestElement(marker, { x: 0, y: 12 }, 2)).toBe(true);
    expect(hitTestElement(marker, { x: 0, y: 14 }, 2)).toBe(false);
  });

  it('cota: por la línea o por su texto', () => {
    // Texto "1 m" de 41,75 a 58,25 cm × −14 a −4 cm. Escala 10: alcance de la línea 1,7 cm.
    const dimension = element({ type: 'dimension', strokeWidth: 2, fontSize: 10 });
    expect(hitTestElement(dimension, { x: 10, y: 1 }, 10)).toBe(true);
    expect(hitTestElement(dimension, { x: 50, y: -12 }, 10)).toBe(true);
    expect(hitTestElement(dimension, { x: 10, y: -12 }, 10)).toBe(false);
    // Con un solo punto no hay texto: solo cuenta el punto.
    const broken = element({ type: 'dimension', points: [{ x: 0, y: 0 }] });
    expect(hitTestElement(broken, { x: 50, y: 50 }, 1)).toBe(false);
  });

  it('sin puntos nunca acierta', () => {
    expect(hitTestElement(element({ points: [] }), { x: 0, y: 0 }, 1)).toBe(false);
  });
});

describe('findElementAt', () => {
  it('devuelve el elemento más alto (el último) bajo el toque', () => {
    const elements = [
      element({ id: 'abajo' }),
      element({ id: 'arriba' }),
      element({
        id: 'lejos',
        points: [
          { x: 0, y: 500 },
          { x: 100, y: 500 },
        ],
      }),
    ];

    expect(findElementAt(elements, { x: 50, y: 0 }, 1)).toBe('arriba');
    expect(findElementAt(elements, { x: 50, y: 500 }, 1)).toBe('lejos');
    expect(findElementAt(elements, { x: 50, y: 250 }, 1)).toBeNull();
    expect(findElementAt([], { x: 0, y: 0 }, 1)).toBeNull();
  });

  it('la tolerancia depende de la escala', () => {
    const elements = [element({ id: 'linea' })];
    expect(findElementAt(elements, { x: 50, y: 10 }, 1)).toBe('linea');
    expect(findElementAt(elements, { x: 50, y: 10 }, 5)).toBeNull();
  });
});
