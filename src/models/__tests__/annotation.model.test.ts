import {
  annotationFromRow,
  argbToCss,
  elementCountLabel,
  hexToArgb,
  parseElements,
  serializeElements,
  type AnnotationElement,
} from '../annotation.model';

const element = (overrides: Partial<AnnotationElement> = {}): AnnotationElement => ({
  id: 'e1',
  type: 'freeStroke',
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 },
  ],
  color: 0xff0d4f8b,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
  ...overrides,
});

describe('serialización de elementos', () => {
  it('ida y vuelta conserva los elementos', () => {
    const elements = [
      element(),
      element({
        id: 'e2',
        type: 'text',
        points: [{ x: 0.5, y: 0.5 }],
        text: 'Tablero',
        fontSize: 18,
      }),
      element({ id: 'e3', type: 'marker', points: [{ x: 1, y: 0 }], opacity: 0.5 }),
    ];

    expect(parseElements(serializeElements(elements))).toEqual(elements);
  });

  it('lee el formato de la app original (Flutter)', () => {
    const json =
      '[{"id":"a1","type":"freeStroke","points":[{"x":0.1,"y":0.2},{"x":0.15,"y":0.25}],' +
      '"color":4294198070,"strokeWidth":2.0,"text":null,"fontSize":null,"opacity":1.0}]';

    const [parsed] = parseElements(json);

    expect(parsed).toEqual({
      id: 'a1',
      type: 'freeStroke',
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.15, y: 0.25 },
      ],
      color: 4294198070,
      strokeWidth: 2,
      text: null,
      fontSize: null,
      opacity: 1,
    });
    expect(argbToCss(parsed?.color ?? 0)).toBe('rgba(244, 67, 54, 1)');
  });

  it('escribe las mismas claves que la app original', () => {
    const [stored] = JSON.parse(serializeElements([element()])) as Record<string, unknown>[];

    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ['color', 'fontSize', 'id', 'opacity', 'points', 'strokeWidth', 'text', 'type'].sort(),
    );
  });

  it('descarta tipos desconocidos, el borrador y elementos sin puntos válidos', () => {
    const json = JSON.stringify([
      {
        id: 'ok',
        type: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        color: 1,
      },
      { id: 'raro', type: 'hexagono', points: [{ x: 0, y: 0 }] },
      { id: 'goma', type: 'eraser', points: [{ x: 0, y: 0 }] },
      { id: 'vacio', type: 'line', points: [] },
      { id: 'malos', type: 'line', points: [{ x: 'a', y: null }] },
      { id: 'sin-texto', type: 'text', points: [{ x: 0, y: 0 }], text: '  ' },
      'no-es-objeto',
    ]);

    expect(parseElements(json).map((item) => item.id)).toEqual(['ok']);
  });

  it('recorta las coordenadas a 0–1', () => {
    const json = JSON.stringify([
      {
        id: 'e',
        type: 'line',
        points: [
          { x: -0.5, y: 1.7 },
          { x: 0.5, y: 0.5 },
        ],
      },
    ]);

    expect(parseElements(json)[0]?.points).toEqual([
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
    ]);
  });

  it('redondea las coordenadas a 4 decimales al guardar', () => {
    const json = serializeElements([element({ points: [{ x: 0.123456789, y: 0.98765 }] })]);

    expect(json).toContain('{"x":0.1235,"y":0.9877}');
  });

  it('un JSON inválido o que no es una lista da una lista vacía', () => {
    expect(parseElements('{no es json')).toEqual([]);
    expect(parseElements('{"a":1}')).toEqual([]);
    expect(parseElements(null)).toEqual([]);
    expect(parseElements('')).toEqual([]);
  });

  it('completa valores ausentes con valores por defecto', () => {
    const [parsed] = parseElements([{ type: 'marker', points: [{ x: 0.2, y: 0.2 }] }]);

    expect(parsed).toMatchObject({
      id: 'elemento-0',
      color: 0xff000000,
      strokeWidth: 2,
      opacity: 1,
    });
  });
});

describe('colores ARGB', () => {
  it('argbToCss convierte color opaco y con transparencia', () => {
    expect(argbToCss(0xfff44336)).toBe('rgba(244, 67, 54, 1)');
    expect(argbToCss(0x800d4f8b)).toBe('rgba(13, 79, 139, 0.502)');
    expect(argbToCss(0x00000000)).toBe('rgba(0, 0, 0, 0)');
  });

  it('argbToCss trata los enteros "negativos" como sin signo', () => {
    // 0xFFF44336 como entero con signo de 32 bits.
    expect(argbToCss(-769226)).toBe('rgba(244, 67, 54, 1)');
  });

  it('hexToArgb añade alfa 255 y da un entero sin signo', () => {
    expect(hexToArgb('#F44336')).toBe(4294198070);
    expect(hexToArgb('#0d4f8b')).toBe(0xff0d4f8b);
    expect(hexToArgb('#000000')).toBe(0xff000000);
    expect(hexToArgb('rojo')).toBe(0xff000000);
  });

  it('hexToArgb y argbToCss son coherentes', () => {
    expect(argbToCss(hexToArgb('#2E7D32'))).toBe('rgba(46, 125, 50, 1)');
  });
});

describe('annotationFromRow', () => {
  it('convierte la fila con su referencia y elementos', () => {
    const annotation = annotationFromRow({
      id: 'a1',
      visit_id: 'v1',
      title: null,
      elements: serializeElements([element()]),
      base_image_path: null,
      canvas_width: 390,
      canvas_height: 600,
      sync_status: 'pendingSync',
      created_at: '2026-06-01T10:00:00.000Z',
      updated_at: '2026-06-01T10:05:00.000Z',
    });

    expect(annotation).toMatchObject({
      id: 'a1',
      visitId: 'v1',
      canvasWidth: 390,
      canvasHeight: 600,
      syncStatus: 'pendingSync',
    });
    expect(annotation.elements).toHaveLength(1);
  });

  it('sin referencia válida la deja en null', () => {
    const annotation = annotationFromRow({ id: 'a1', visit_id: 'v1', canvas_width: 0 });

    expect(annotation.canvasWidth).toBeNull();
    expect(annotation.canvasHeight).toBeNull();
    expect(annotation.elements).toEqual([]);
  });
});

describe('elementCountLabel', () => {
  it('usa singular y plural', () => {
    expect(elementCountLabel(0)).toBe('0 elementos');
    expect(elementCountLabel(1)).toBe('1 elemento');
    expect(elementCountLabel(7)).toBe('7 elementos');
  });
});
