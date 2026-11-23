import {
  annotationFromRow,
  argbToCss,
  elementCountLabel,
  figureFromRow,
  hexToArgb,
  LEGACY_DEFAULT_REFERENCE,
  parseElements,
  parseFormatVersion,
  PLAN_FORMAT_VERSION,
  planCountLabel,
  planTitle,
  serializeElements,
  type AnnotationElement,
} from '../annotation.model';

jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

/** Elemento en el formato 2 (centímetros). */
const element = (overrides: Partial<AnnotationElement> = {}): AnnotationElement => ({
  id: 'e1',
  type: 'freeStroke',
  points: [
    { x: 10, y: 20 },
    { x: 30, y: 40 },
  ],
  color: 0xff0d4f8b,
  strokeWidth: 4,
  text: null,
  fontSize: null,
  opacity: 1,
  ...overrides,
});

const line = (points: { x: number; y: number }[], extra: Record<string, unknown> = {}) => ({
  id: 'l',
  type: 'line',
  points,
  color: 0xff000000,
  strokeWidth: 2,
  ...extra,
});

describe('formato 2 (centímetros)', () => {
  it('ida y vuelta conserva los elementos, incluida la cota', () => {
    const elements = [
      element(),
      element({
        id: 'e2',
        type: 'text',
        points: [{ x: 50, y: 50 }],
        text: 'Tablero',
        fontSize: 18,
      }),
      element({ id: 'e3', type: 'marker', points: [{ x: 100, y: 0 }], opacity: 0.5 }),
      element({
        id: 'e4',
        type: 'dimension',
        points: [
          { x: 0, y: 0 },
          { x: 235, y: 0 },
        ],
        fontSize: 12.5,
      }),
    ];

    expect(parseElements(serializeElements(elements))).toEqual(elements);
    expect(parseElements(serializeElements(elements), { formatVersion: 2 })).toEqual(elements);
  });

  it('no recorta las coordenadas: el plano no tiene límites', () => {
    const json = JSON.stringify([
      line([
        { x: -1500.5, y: 87000 },
        { x: 0.5, y: 2 },
      ]),
    ]);

    expect(parseElements(json)[0]?.points).toEqual([
      { x: -1500.5, y: 87000 },
      { x: 0.5, y: 2 },
    ]);
  });

  it('lee la cota como cualquier forma de dos puntos', () => {
    const [parsed] = parseElements([
      {
        id: 'c1',
        type: 'dimension',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 350 },
        ],
        fontSize: 20,
      },
    ]);

    expect(parsed).toMatchObject({ id: 'c1', type: 'dimension', fontSize: 20, text: null });
  });

  it('serializa coordenadas y tamaño de letra con 2 decimales', () => {
    const json = serializeElements([
      element({
        type: 'text',
        points: [{ x: 12.345678, y: -0.987 }],
        text: 'A',
        fontSize: 3.33333,
      }),
    ]);
    const [stored] = JSON.parse(json) as Record<string, unknown>[];

    expect(stored?.points).toEqual([{ x: 12.35, y: -0.99 }]);
    expect(stored?.fontSize).toBe(3.33);
  });

  it('escribe las mismas claves que la app original y el color sin signo', () => {
    const [stored] = JSON.parse(serializeElements([element({ color: -769226 })])) as Record<
      string,
      unknown
    >[];

    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ['color', 'fontSize', 'id', 'opacity', 'points', 'strokeWidth', 'text', 'type'].sort(),
    );
    expect(stored?.color).toBe(0xfff44336);
    expect(stored?.fontSize).toBeNull();
  });
});

describe('formato 1 (puntos normalizados)', () => {
  const legacy = JSON.stringify([
    line([
      { x: 0.25, y: 0.5 },
      { x: 1, y: 0 },
    ]),
  ]);

  it('convierte a centímetros con el lienzo de referencia (1 px = 1 cm)', () => {
    const [parsed] = parseElements(legacy, {
      formatVersion: 1,
      reference: { width: 390, height: 600 },
    });

    expect(parsed?.points).toEqual([
      { x: 97.5, y: 300 },
      { x: 390, y: 0 },
    ]);
  });

  it('sin referencia (o con una no válida) usa LEGACY_DEFAULT_REFERENCE', () => {
    const expected = [
      { x: 0.25 * LEGACY_DEFAULT_REFERENCE.width, y: 0.5 * LEGACY_DEFAULT_REFERENCE.height },
      { x: LEGACY_DEFAULT_REFERENCE.width, y: 0 },
    ];

    expect(parseElements(legacy, { formatVersion: 1 })[0]?.points).toEqual(expected);
    expect(parseElements(legacy, { formatVersion: 1, reference: null })[0]?.points).toEqual(
      expected,
    );
    expect(
      parseElements(legacy, { formatVersion: 1, reference: { width: 0, height: -3 } })[0]?.points,
    ).toEqual(expected);
  });

  it('recorta los puntos fuera de 0–1 antes de convertirlos', () => {
    const json = JSON.stringify([
      line([
        { x: -0.5, y: 1.7 },
        { x: 0.5, y: 0.5 },
      ]),
    ]);

    expect(
      parseElements(json, { formatVersion: 1, reference: { width: 200, height: 100 } })[0]?.points,
    ).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
    ]);
  });

  it('lee el formato de la app original (Flutter)', () => {
    const json =
      '[{"id":"a1","type":"freeStroke","points":[{"x":0.1,"y":0.2},{"x":0.15,"y":0.25}],' +
      '"color":4294198070,"strokeWidth":2.0,"text":null,"fontSize":null,"opacity":1.0}]';

    const [parsed] = parseElements(json, {
      formatVersion: 1,
      reference: { width: 400, height: 600 },
    });

    expect(parsed).toEqual({
      id: 'a1',
      type: 'freeStroke',
      points: [
        { x: 40, y: 120 },
        { x: 60, y: 150 },
      ],
      color: 4294198070,
      strokeWidth: 2,
      text: null,
      fontSize: null,
      opacity: 1,
    });
    expect(argbToCss(parsed?.color ?? 0)).toBe('rgba(244, 67, 54, 1)');
  });
});

describe('lectura tolerante', () => {
  it('descarta tipos desconocidos, el borrador y elementos sin puntos válidos', () => {
    const json = JSON.stringify([
      line(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        { id: 'ok' },
      ),
      { id: 'raro', type: 'hexagono', points: [{ x: 0, y: 0 }] },
      { id: 'goma', type: 'eraser', points: [{ x: 0, y: 0 }] },
      { id: 'vacio', type: 'line', points: [] },
      { id: 'sin-lista', type: 'marker', points: 'no' },
      { id: 'malos', type: 'line', points: [{ x: 'a', y: null }, 'no-es-punto'] },
      { id: 'sin-texto', type: 'text', points: [{ x: 0, y: 0 }], text: '  ' },
      'no-es-objeto',
    ]);

    expect(parseElements(json).map((item) => item.id)).toEqual(['ok']);
  });

  it('descarta los tipos de dos puntos que solo traen uno', () => {
    const single = [{ x: 5, y: 5 }];
    const elements = ['line', 'arrow', 'rectangle', 'circle', 'dimension'].map((type) => ({
      id: type,
      type,
      points: single,
    }));
    const kept = [
      { id: 'lapiz', type: 'freeStroke', points: single },
      { id: 'marca', type: 'marker', points: single },
      { id: 'texto', type: 'text', points: single, text: 'Rack' },
    ];

    expect(parseElements([...elements, ...kept]).map((item) => item.id)).toEqual([
      'lapiz',
      'marca',
      'texto',
    ]);
  });

  it('un JSON inválido o que no es una lista da una lista vacía', () => {
    expect(parseElements('{no es json')).toEqual([]);
    expect(parseElements('{"a":1}')).toEqual([]);
    expect(parseElements(null)).toEqual([]);
    expect(parseElements(undefined)).toEqual([]);
    expect(parseElements('')).toEqual([]);
  });

  it('completa valores ausentes o no válidos con valores por defecto', () => {
    const [parsed] = parseElements([
      {
        id: '',
        type: 'marker',
        points: [{ x: 20, y: 20 }],
        strokeWidth: -1,
        fontSize: 0,
        opacity: 7,
        text: 5,
      },
    ]);

    expect(parsed).toEqual({
      id: 'elemento-0',
      type: 'marker',
      points: [{ x: 20, y: 20 }],
      color: 0xff000000,
      strokeWidth: 2,
      text: null,
      fontSize: null,
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

describe('parseFormatVersion', () => {
  it('solo el 2 (número o texto) es el formato 2', () => {
    expect(PLAN_FORMAT_VERSION).toBe(2);
    expect(parseFormatVersion(2)).toBe(2);
    expect(parseFormatVersion('2')).toBe(2);
  });

  it('cualquier otro valor es el formato 1 (filas antiguas)', () => {
    for (const value of [1, '1', null, undefined, 3, 'dos', 2.5, Number.NaN]) {
      expect(parseFormatVersion(value)).toBe(1);
    }
  });
});

describe('annotationFromRow', () => {
  const row = {
    id: 'a1',
    visit_id: 'v1',
    title: 'Planta baja',
    base_image_path: null,
    sync_status: 'pendingSync',
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:05:00.000Z',
  };

  it('fila del formato 2: elementos tal cual', () => {
    const annotation = annotationFromRow({
      ...row,
      elements: serializeElements([element()]),
      format_version: 2,
      canvas_width: null,
      canvas_height: null,
    });

    expect(annotation).toEqual({
      id: 'a1',
      visitId: 'v1',
      title: 'Planta baja',
      elements: [element()],
      baseImagePath: null,
      formatVersion: 2,
      canvasWidth: null,
      canvasHeight: null,
      syncStatus: 'pendingSync',
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:05:00.000Z',
    });
  });

  it('fila del formato 1: convierte con su lienzo (aunque venga como texto)', () => {
    const annotation = annotationFromRow({
      ...row,
      elements: JSON.stringify([
        line([
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ]),
      ]),
      format_version: null,
      canvas_width: '390',
      canvas_height: 600,
    });

    expect(annotation).toMatchObject({ formatVersion: 1, canvasWidth: 390, canvasHeight: 600 });
    expect(annotation.elements[0]?.points).toEqual([
      { x: 195, y: 300 },
      { x: 390, y: 600 },
    ]);
  });

  it('fila del formato 1 sin lienzo válido: usa la referencia por defecto', () => {
    const annotation = annotationFromRow({
      ...row,
      elements: JSON.stringify([
        line([
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]),
      ]),
      canvas_width: 0,
      canvas_height: 600,
    });

    expect(annotation.canvasWidth).toBeNull();
    expect(annotation.canvasHeight).toBe(600);
    expect(annotation.elements[0]?.points[1]).toEqual({
      x: LEGACY_DEFAULT_REFERENCE.width,
      y: LEGACY_DEFAULT_REFERENCE.height,
    });
  });

  it('valores ausentes: título null, visita vacía, sin elementos', () => {
    const annotation = annotationFromRow({ id: 7, title: '' });

    expect(annotation).toMatchObject({
      id: '7',
      visitId: '',
      title: null,
      elements: [],
      formatVersion: 1,
      createdAt: '',
      updatedAt: null,
    });
  });
});

describe('figureFromRow', () => {
  it('convierte la fila de la biblioteca', () => {
    const figure = figureFromRow({
      id: 'f1',
      technician_id: 't1',
      name: 'Puerta',
      elements: serializeElements([element()]),
      width: 120.5,
      height: '30',
      created_at: '2026-06-01T10:00:00.000Z',
    });

    expect(figure).toEqual({
      id: 'f1',
      technicianId: 't1',
      name: 'Puerta',
      elements: [element()],
      width: 120.5,
      height: 30,
      createdAt: '2026-06-01T10:00:00.000Z',
    });
  });

  it('valores ausentes o no válidos', () => {
    expect(figureFromRow({ id: 'f2', name: '', width: -5, height: 'x' })).toEqual({
      id: 'f2',
      technicianId: '',
      name: 'Figura',
      elements: [],
      width: 0,
      height: 0,
      createdAt: '',
    });
  });
});

describe('textos', () => {
  it('elementCountLabel usa singular y plural', () => {
    expect(elementCountLabel(0)).toBe('0 elementos');
    expect(elementCountLabel(1)).toBe('1 elemento');
    expect(elementCountLabel(7)).toBe('7 elementos');
  });

  it('planCountLabel usa singular y plural', () => {
    expect(planCountLabel(0)).toBe('0 planos');
    expect(planCountLabel(1)).toBe('1 plano');
    expect(planCountLabel(3)).toBe('3 planos');
  });

  it('planTitle usa el título limpio o "Plano N"', () => {
    expect(planTitle({ title: '  Planta baja ' }, 1)).toBe('Planta baja');
    expect(planTitle({ title: null }, 2)).toBe('Plano 2');
    expect(planTitle({ title: '   ' }, 3)).toBe('Plano 3');
  });
});
