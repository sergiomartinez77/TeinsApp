import guide from '../guide.json';
import { normalizeText, sanitizeSearch, wordMatches } from '../text.ts';
import {
  executeTool,
  findGuideTopic,
  limitJson,
  localDayToUtc,
  MAX_TOOL_RESULT_CHARS,
  TOOL_DEFINITIONS,
  type ToolContext,
} from '../tools.ts';

import { eqValue, fakeDb, hasCall, type Resolver, type Row } from './fakes.ts';

/** Herramientas del asistente con Claude sobre una base falsa (la RLS la aplica Supabase). */

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const CATALOG: Row[] = [
  {
    id: 'm1',
    code: 'CAB-01',
    name: 'Cable UTP Cat6',
    unit: 'metro',
    category: 'Redes',
    min_stock: '100',
  },
  { id: 'm2', code: 'BRK-20', name: 'Breaker 20A', unit: 'unidad', category: null, min_stock: 5 },
  {
    id: 'm3',
    code: 'RJ-45',
    name: 'Conector RJ45',
    unit: 'unidad',
    category: null,
    min_stock: null,
  },
  { id: 'm4', code: 'CIN-01', name: 'Cinta aislante', unit: 'rollo', category: null, min_stock: 3 },
];
const STOCK: Row[] = [
  {
    material_id: 'm1',
    purchased: '120',
    adjusted: '0',
    used: '70.5',
    on_hand: '49.5',
    updated_at: '2026-11-22T10:00:00Z',
  },
  { material_id: 'm2', purchased: 10, adjusted: -1, used: 0, on_hand: 9, updated_at: null },
  { material_id: 'm3', purchased: 200, adjusted: 0, used: 0, on_hand: 200, updated_at: null },
];

const VISITS: Row[] = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    title: 'Revisión de red',
    client_name: 'Clínica Ñandú',
    address: 'Av. 1',
    visit_type: 'datos',
    status: 'inProgress',
    created_at: '2026-11-22T13:00:00Z',
    started_at: null,
    completed_at: null,
    technician_id: USER,
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    title: 'Tablero',
    client_name: 'Banco Central',
    address: null,
    visit_type: 'energia',
    status: 'completed',
    created_at: '2026-10-14T13:00:00Z',
    started_at: null,
    completed_at: '2026-10-15T17:00:00Z',
    technician_id: OTHER,
  },
];

function context(resolve: Resolver, overrides: Partial<ToolContext> = {}) {
  const db = fakeDb(resolve);
  return {
    db,
    context: {
      db,
      userId: USER,
      role: 'technician',
      guide,
      timezoneOffsetMinutes: 300,
      ...overrides,
    },
  };
}

const inventory: Resolver = (table) => {
  if (table === 'material_catalog') return CATALOG;
  if (table === 'material_stock') return STOCK;
  return [];
};

const parse = (content: string) => JSON.parse(content) as Record<string, unknown>;

describe('definiciones', () => {
  it('seis herramientas con esquema estricto y sin forzar su uso', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'consultar_stock',
      'sugerencias_compra',
      'consumo_materiales',
      'buscar_visitas',
      'guia_uso',
      'generar_pdf_visita',
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });
});

describe('inventario', () => {
  it('consultar_stock con búsqueda sin tildes ni mayúsculas', async () => {
    const { db, context: ctx } = context(inventory);
    const outcome = await executeTool('consultar_stock', { busqueda: 'CABLE utp' }, ctx);
    expect(outcome.isError).toBe(false);
    const result = parse(outcome.content);
    expect(result).toMatchObject({ materiales_activos: 4, bajo_minimo: 1, coincidencias: 1 });
    expect(result.materiales).toEqual([
      {
        codigo: 'CAB-01',
        nombre: 'Cable UTP Cat6',
        unidad: 'metro',
        categoria: 'Redes',
        en_bodega: 49.5,
        minimo: 100,
        bajo_minimo: true,
        comprar_sugerido: 51,
        compras: 120,
        ajustes: 0,
        usado_en_visitas: 70.5,
        actualizado: '2026-11-22T10:00:00Z',
      },
    ]);
    expect(eqValue(db.log[0]?.calls ?? [], 'is_active')).toBe(true);
  });

  it('consultar_stock sin búsqueda: primero bajo mínimo; sin existencias = null', async () => {
    const { context: ctx } = context(inventory);
    const result = parse((await executeTool('consultar_stock', {}, ctx)).content);
    const items = result.materiales as Row[];
    expect(items[0]?.codigo).toBe('CAB-01');
    expect(items.find((item) => item.codigo === 'CIN-01')).toMatchObject({
      en_bodega: null,
      bajo_minimo: false,
      compras: null,
    });
    expect(
      parse((await executeTool('consultar_stock', { busqueda: 'cabel' }, ctx)).content)
        .coincidencias,
    ).toBe(1);
  });

  it('sugerencias_compra', async () => {
    const { context: ctx } = context(inventory);
    const result = parse((await executeTool('sugerencias_compra', {}, ctx)).content);
    expect(result).toMatchObject({ por_comprar: 1, materiales_sin_minimo: 1 });
    expect(result.sugerencias).toEqual([
      {
        codigo: 'CAB-01',
        nombre: 'Cable UTP Cat6',
        unidad: 'metro',
        en_bodega: 49.5,
        minimo: 100,
        comprar: 51,
      },
    ]);
  });

  it('error de la base → resultado de error, sin lanzar', async () => {
    const { context: ctx } = context(() => ({
      data: null,
      error: { message: 'permission denied' },
    }));
    const outcome = await executeTool('sugerencias_compra', {}, ctx);
    expect(outcome).toEqual({
      content: JSON.stringify({ error: 'Error de la base de datos: permission denied' }),
      isError: true,
    });
    const thrower = context(() => {
      throw new Error('socket');
    });
    expect((await executeTool('consultar_stock', {}, thrower.context)).content).toContain(
      'No se pudo consultar la base de datos.',
    );
  });
});

describe('consumo_materiales', () => {
  it('suma por material en las visitas del rango, en bloques de ids', async () => {
    const visitIds = Array.from({ length: 150 }, (_, index) => ({ id: `v${index}` }));
    const { db, context: ctx } = context((table, calls) => {
      if (table === 'visits') return visitIds;
      const ids = (calls.find((call) => call.method === 'in')?.args[1] ?? []) as string[];
      return ids.includes('v0')
        ? [
            {
              material_id: 'm1',
              material_code: 'CAB-01',
              material_name: 'Cable UTP Cat6',
              unit: 'metro',
              quantity: '12.5',
              visit_id: 'v0',
            },
            {
              material_id: 'm1',
              material_code: 'CAB-01',
              material_name: 'Cable UTP Cat6',
              unit: 'metro',
              quantity: 0.1,
              visit_id: 'v1',
            },
            {
              material_id: null,
              material_code: 'X',
              material_name: 'X',
              unit: 'u',
              quantity: 1,
              visit_id: 'v1',
            },
          ]
        : [
            {
              material_id: 'm2',
              material_code: 'BRK-20',
              material_name: 'Breaker 20A',
              unit: 'unidad',
              quantity: 2,
              visit_id: 'v120',
            },
          ];
    });
    const result = parse(
      (await executeTool('consumo_materiales', { desde: '2026-11-01', hasta: '2026-11-22' }, ctx))
        .content,
    );
    expect(result).toMatchObject({ visitas_en_rango: 150, materiales_distintos: 2 });
    expect(result.materiales).toEqual([
      { codigo: 'CAB-01', nombre: 'Cable UTP Cat6', unidad: 'metro', cantidad: 12.6, visitas: 2 },
      { codigo: 'BRK-20', nombre: 'Breaker 20A', unidad: 'unidad', cantidad: 2, visitas: 1 },
    ]);
    // Rango en UTC a partir de la hora local (UTC−5).
    const orFilter = db.log[0]?.calls.find((call) => call.method === 'or')?.args[0];
    expect(orFilter).toBe(
      'and(completed_at.gte.2026-11-01T05:00:00.000Z,completed_at.lte.2026-11-23T04:59:59.999Z),and(completed_at.is.null,created_at.gte.2026-11-01T05:00:00.000Z,created_at.lte.2026-11-23T04:59:59.999Z)',
    );
    const materialQueries = db.log.filter((entry) => entry.table === 'visit_materials');
    expect(materialQueries).toHaveLength(2);
    expect(eqValue(materialQueries[0]?.calls ?? [], 'is_custom')).toBe(false);
  });

  it.each([
    [{ desde: '1/11/2026', hasta: '2026-11-22' }, 'AAAA-MM-DD'],
    [{ desde: '2026-02-31', hasta: '2026-03-01' }, 'AAAA-MM-DD'],
    [{ desde: '2026-11-22', hasta: '2026-11-01' }, 'posterior'],
    [{ desde: '2024-01-01', hasta: '2026-01-01' }, 'un año'],
  ])('fechas no válidas %j', async (input, error) => {
    const { context: ctx } = context(() => []);
    const outcome = await executeTool('consumo_materiales', input, ctx);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain(error);
  });

  it('localDayToUtc', () => {
    expect(localDayToUtc('2026-11-22', 0, false)?.toISOString()).toBe('2026-11-22T00:00:00.000Z');
    expect(localDayToUtc('2026-11-22', -60, true)?.toISOString()).toBe('2026-11-22T22:59:59.999Z');
    expect(localDayToUtc('ayer', 0, false)).toBeNull();
  });
});

describe('buscar_visitas', () => {
  it('por estado y texto; nombres de técnicos ajenos (oficina/admin)', async () => {
    const { db, context: ctx } = context(
      (table) => {
        if (table === 'visits') return VISITS;
        if (table === 'profiles') return [{ id: OTHER, full_name: 'Luis Gómez', email: 'l@t.com' }];
        return [];
      },
      { role: 'office' },
    );
    const result = parse(
      (
        await executeTool(
          'buscar_visitas',
          { busqueda: 'Banco, (Central)*', estado: 'pendientes' },
          ctx,
        )
      ).content,
    );
    const visitCalls = db.log[0]?.calls ?? [];
    expect(visitCalls).toContainEqual({
      method: 'in',
      args: ['status', ['assigned', 'inProgress']],
    });
    expect(visitCalls).toContainEqual({
      method: 'or',
      args: [
        'title.ilike.*Banco Central*,client_name.ilike.*Banco Central*,address.ilike.*Banco Central*',
      ],
    });
    expect(result.visitas).toEqual([
      expect.objectContaining({
        titulo: 'Revisión de red',
        estado: 'En progreso',
        es_del_usuario: true,
      }),
      expect.objectContaining({
        cliente: 'Banco Central',
        estado: 'Completada',
        tecnico: 'Luis Gómez',
        es_del_usuario: false,
      }),
    ]);
  });

  it('sin coincidencias exactas busca sin tildes en las recientes', async () => {
    const { db, context: ctx } = context((table, calls) =>
      table === 'visits' && hasCall(calls, 'or') ? [] : VISITS.slice(0, 1),
    );
    const result = parse(
      (await executeTool('buscar_visitas', { busqueda: 'clinica nandu', estado: 'otra' }, ctx))
        .content,
    );
    expect(result).toMatchObject({ estado: 'todas', mostradas: 1 });
    expect(db.log.filter((entry) => entry.table === 'profiles')).toHaveLength(0);
    const all = parse((await executeTool('buscar_visitas', {}, ctx)).content);
    expect(all.mostradas).toBe(1);
  });
});

describe('generar_pdf_visita', () => {
  const byId: Resolver = (table, calls) =>
    VISITS.filter((visit) => visit.id === eqValue(calls, 'id'));

  it('visita propia → acción share_pdf (no genera nada en el servidor)', async () => {
    const { context: ctx } = context(byId);
    const outcome = await executeTool('generar_pdf_visita', { visit_id: VISITS[0]?.id }, ctx);
    expect(outcome.isError).toBe(false);
    expect(outcome.action).toEqual({
      type: 'share_pdf',
      visitId: VISITS[0]?.id,
      label: 'Clínica Ñandú — Revisión de red',
    });
  });

  it('visita de otro técnico, inexistente, id no válido o error', async () => {
    const { context: ctx } = context(byId, { role: 'admin' });
    const other = await executeTool('generar_pdf_visita', { visit_id: VISITS[1]?.id }, ctx);
    expect(other).toMatchObject({ isError: true });
    expect(other.action).toBeUndefined();
    expect(other.content).toContain('otro técnico');
    expect(
      (await executeTool('generar_pdf_visita', { visit_id: 'bbbbbbbb-0000' }, ctx)).content,
    ).toContain('No existe');
    expect(
      (await executeTool('generar_pdf_visita', { visit_id: '1; drop' }, ctx)).content,
    ).toContain('no es un id');
    const broken = context(() => ({ data: null, error: { message: 'x' } }));
    expect(
      (await executeTool('generar_pdf_visita', { visit_id: VISITS[0]?.id }, broken.context))
        .isError,
    ).toBe(true);
  });
});

describe('guia_uso', () => {
  it('lista, tema por id o palabras, nota del rol', async () => {
    const { context: ctx } = context(() => [], { role: 'office' });
    const list = parse((await executeTool('guia_uso', {}, ctx)).content);
    expect((list.temas as Row[]).length).toBe(guide.topics.length);
    const topic = parse((await executeTool('guia_uso', { tema: 'inventario' }, ctx)).content);
    expect(topic).toMatchObject({ encontrado: true, id: 'inventario' });
    expect(topic.nota_para_el_rol).toContain('Oficina puede registrar');
    expect(findGuideTopic(guide, '¿cómo tomo fotos con ubicación?')?.id).toBe('fotos');
    expect(findGuideTopic(guide, 'cerrar sesion')?.id).toBe('iniciar-sesion');
    const none = parse((await executeTool('guia_uso', { tema: 'zzzz' }, ctx)).content);
    expect(none.encontrado).toBe(false);
    const client = context(() => [], { role: 'client' });
    expect(
      parse((await executeTool('guia_uso', { tema: 'pdf' }, client.context)).content)
        .nota_para_el_rol,
    ).toBeNull();
  });

  it('herramienta desconocida y entrada no válida', async () => {
    const { context: ctx } = context(() => []);
    expect((await executeTool('borrar_todo', {}, ctx)).isError).toBe(true);
    expect((await executeTool('guia_uso', null, ctx)).isError).toBe(false);
  });
});

describe('utilidades', () => {
  it('recorta resultados grandes y limpia búsquedas', () => {
    const big = limitJson({ items: 'x'.repeat(MAX_TOOL_RESULT_CHARS * 2) });
    expect(big.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + 50);
    expect(JSON.parse(big)).toMatchObject({ recortado: true });
    expect(limitJson({ a: 1 })).toBe('{"a":1}');
    expect(sanitizeSearch(' a,b(c)*%d "e" ')).toBe('a b c d e');
    expect(normalizeText('Ñandú')).toBe('nandu');
    expect(wordMatches('cabels', 'cable')).toBe(true);
    expect(wordMatches('de', 'demo')).toBe(false);
    expect(wordMatches('fot', 'fotografia')).toBe(true);
    expect(wordMatches('tableros', 'tablero')).toBe(true);
    expect(wordMatches('cable', 'breaker')).toBe(false);
    expect(wordMatches('cablx', 'cable')).toBe(true);
    expect(wordMatches('cabre', 'cablex')).toBe(false);
  });
});
