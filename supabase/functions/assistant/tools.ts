import { matchesAllWords, normalizeText, sanitizeSearch, tokenize, wordMatches } from './text.ts';
import type {
  DbLike,
  GuideJson,
  GuideRole,
  GuideTopicJson,
  PgQuery,
  SharePdfAction,
} from './types.ts';

/**
 * Herramientas del asistente con Claude. Se ejecutan EN LA FUNCIÓN con el
 * cliente de Supabase creado con el token del usuario, así que cada consulta
 * respeta la RLS: el técnico ve sus visitas; oficina y administración, todas.
 * Ninguna escribe nada. `generar_pdf_visita` no genera el PDF: devuelve una
 * acción que la app ejecuta en el teléfono con la API de informes (admin y
 * oficina tienen todas las visitas en el teléfono: stream visitas_de_oficina).
 *
 * Conteo inicial: un material con existencias pero sin compras ni ajustes
 * (compras = 0 y ajustes = 0) no tiene conteo inicial; su "en bodega" sería
 * solo el uso en visitas en negativo. Se devuelve `sin_conteo_inicial: true`,
 * `en_bodega: null` y nunca entra en las sugerencias de compra (misma regla
 * que la app: `needsInitialCount` en src/models/inventory.model.ts).
 *
 * Los resultados se recortan para no gastar tokens de más.
 */

export interface ToolContext {
  readonly db: DbLike;
  readonly userId: string;
  readonly role: string;
  readonly guide: GuideJson;
  /** Minutos a sumar a la hora local para obtener UTC (`Date#getTimezoneOffset` del teléfono). */
  readonly timezoneOffsetMinutes: number;
}

export interface ToolOutcome {
  /** Texto (JSON) que recibe Claude como resultado. */
  readonly content: string;
  readonly isError: boolean;
  readonly action?: SharePdfAction;
}

/** Máximo de caracteres del resultado de una herramienta. */
export const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_STOCK_ITEMS = 25;
const MAX_SUGGESTIONS = 50;
const MAX_CONSUMPTION_ITEMS = 30;
const MAX_VISITS = 20;
const MAX_VISIT_MATERIALS = 200;
const MAX_USAGE_VISITS = 20;
const MAX_USAGE_ROWS = 5000;
const MAX_CATALOG = 2000;
const MAX_RANGE_VISITS = 2000;
const ID_CHUNK = 100;

const VISIT_STATES = ['pendientes', 'asignadas', 'en_progreso', 'completadas', 'todas'] as const;
type VisitState = (typeof VISIT_STATES)[number];

const STATUS_FILTER: Readonly<Record<VisitState, readonly string[] | null>> = {
  pendientes: ['assigned', 'inProgress'],
  asignadas: ['assigned'],
  en_progreso: ['inProgress'],
  completadas: ['completed', 'pendingReview', 'synced'],
  todas: null,
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  assigned: 'Asignada',
  inProgress: 'En progreso',
  completed: 'Completada',
  pendingReview: 'En revisión',
  synced: 'Sincronizada',
};

/** Definiciones que recibe Claude (orden fijo: forma parte del prefijo en caché). */
export const TOOL_DEFINITIONS = [
  {
    name: 'consultar_stock',
    description:
      'Existencias actuales de la bodega por material (calculadas en el servidor: compras + ajustes − uso en visitas), con su mínimo. Úsala cuando pregunten cuánto queda o hay de un material o por el stock en general. Sin "busqueda" devuelve primero los materiales bajo mínimo. sin_conteo_inicial = nunca tuvo compras ni ajustes: no se sabe cuánto hay (en_bodega null).',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: {
          type: 'string',
          description:
            'Parte del nombre o del código del material, p. ej. "cable utp" o "CAB-01". Opcional.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'sugerencias_compra',
    description:
      'Materiales bajo su mínimo de bodega con la cantidad sugerida para volver al mínimo (redondeada hacia arriba). Úsala cuando pregunten qué comprar, qué falta o qué está bajo mínimo. Aparte lista los materiales sin conteo inicial, para los que no se puede calcular cuánto comprar.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'consumo_materiales',
    description:
      'Consumo de materiales del catálogo en visitas entre dos fechas (incluidas), según la fecha de finalización de la visita o, si no terminó, la de creación. Úsala para preguntas de consumo o uso por periodo. Los materiales personalizados no cuentan.',
    input_schema: {
      type: 'object',
      properties: {
        desde: {
          type: 'string',
          description: 'Fecha inicial AAAA-MM-DD (hora local del usuario).',
        },
        hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD (incluida).' },
      },
      required: ['desde', 'hasta'],
      additionalProperties: false,
    },
  },
  {
    name: 'buscar_visitas',
    description:
      'Busca visitas que el usuario puede ver (técnico: las suyas; oficina y administración: todas) por cliente, título o dirección y por estado. Devuelve el id de cada visita (necesario para generar_pdf_visita).',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: { type: 'string', description: 'Cliente, título o dirección. Opcional.' },
        estado: {
          type: 'string',
          enum: [...VISIT_STATES],
          description: 'pendientes = asignadas o en progreso. Por defecto, todas.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'guia_uso',
    description:
      'Guía paso a paso de la app TEINS (la documentación real de sus pantallas). Úsala para cualquier pregunta de cómo hacer algo en la app. Sin "tema" devuelve la lista de temas.',
    input_schema: {
      type: 'object',
      properties: {
        tema: {
          type: 'string',
          description: 'Id del tema o palabras de la pregunta, p. ej. "fotos".',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'generar_pdf_visita',
    description:
      'Prepara el informe PDF de UNA visita: la app mostrará al usuario el botón «Compartir PDF», que lo genera en el teléfono. Úsala solo con un id obtenido de buscar_visitas; si hay varias coincidencias, pregunta antes cuál.',
    input_schema: {
      type: 'object',
      properties: { visit_id: { type: 'string', description: 'Id de la visita.' } },
      required: ['visit_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'materiales_de_visita',
    description:
      'Materiales registrados en UNA visita, con cantidad y unidad tal como se guardaron (los personalizados vienen marcados). Úsala para «¿cuánto cable usé en la visita de Pérez?» o «materiales de la visita del colegio». Pasa visit_id (de buscar_visitas) o busqueda (cliente o título); si hay varias coincidencias devuelve la lista para preguntar cuál.',
    input_schema: {
      type: 'object',
      properties: {
        visit_id: { type: 'string', description: 'Id de la visita (de buscar_visitas).' },
        busqueda: {
          type: 'string',
          description: 'Cliente, título o dirección de la visita, si no tienes el id.',
        },
        material: {
          type: 'string',
          description: 'Parte del nombre o código del material para filtrar. Opcional.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'uso_material_por_visita',
    description:
      'En qué visitas se usó un material del catálogo: una fila por visita con su cantidad (sin sumar entre visitas), de la más reciente a la más antigua, y el total. Úsala para «¿en qué visitas se usó cable?».',
    input_schema: {
      type: 'object',
      properties: {
        material: {
          type: 'string',
          description: 'Parte del nombre o del código del material, p. ej. "cable" o "CAB-01".',
        },
      },
      required: ['material'],
      additionalProperties: false,
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

// ── Utilidades ───────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

class ToolError extends Error {}

const rowsOf = (data: unknown): Row[] =>
  Array.isArray(data)
    ? data.filter((row): row is Row => typeof row === 'object' && row !== null)
    : [];

async function run(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new ToolError(`Error de la base de datos: ${error.message}`);
  return rowsOf(data);
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const ok = (value: unknown): ToolOutcome => ({ content: limitJson(value), isError: false });
const fail = (message: string): ToolOutcome => ({
  content: JSON.stringify({ error: message }),
  isError: true,
});

/** JSON del resultado, recortado si supera el máximo. */
export function limitJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return JSON.stringify({
    recortado: true,
    contenido: text.slice(0, MAX_TOOL_RESULT_CHARS - 100),
  });
}

// ── Inventario ───────────────────────────────────────────────────────────────

interface StockItem {
  codigo: string;
  nombre: string;
  unidad: string;
  categoria: string | null;
  en_bodega: number | null;
  minimo: number | null;
  /** Nunca tuvo compras ni ajustes: no se sabe cuánto hay (en_bodega es null). */
  sin_conteo_inicial: boolean;
  /** Existencias negativas con movimientos registrados: hay que revisar el conteo. */
  stock_negativo: boolean;
  bajo_minimo: boolean;
  comprar_sugerido: number | null;
  compras: number | null;
  ajustes: number | null;
  usado_en_visitas: number | null;
  actualizado: string | null;
}

async function loadStock(db: DbLike): Promise<StockItem[]> {
  const [catalog, stock] = await Promise.all([
    run(
      db
        .from('material_catalog')
        .select('id, code, name, unit, category, min_stock')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(MAX_CATALOG),
    ),
    run(
      db
        .from('material_stock')
        .select('material_id, purchased, adjusted, used, on_hand, updated_at')
        .limit(MAX_CATALOG * 2),
    ),
  ]);
  const byMaterial = new Map(stock.map((row) => [str(row.material_id), row]));
  return catalog.map((row) => {
    const levels = byMaterial.get(str(row.id));
    const purchased = levels ? (num(levels.purchased) ?? 0) : null;
    const adjusted = levels ? (num(levels.adjusted) ?? 0) : null;
    const uncounted = levels !== undefined && purchased === 0 && adjusted === 0;
    const onHand = levels && !uncounted ? num(levels.on_hand) : null;
    const minimum = num(row.min_stock);
    const low = onHand !== null && minimum !== null && onHand < minimum;
    const missing = low ? round3((minimum ?? 0) - (onHand ?? 0)) : 0;
    return {
      codigo: str(row.code),
      nombre: str(row.name),
      unidad: str(row.unit),
      categoria: optionalString(row.category),
      en_bodega: onHand,
      minimo: minimum,
      sin_conteo_inicial: uncounted,
      stock_negativo: onHand !== null && onHand < 0,
      bajo_minimo: low,
      comprar_sugerido: low && missing > 0 ? Math.ceil(missing) : null,
      compras: levels ? num(levels.purchased) : null,
      ajustes: levels ? num(levels.adjusted) : null,
      usado_en_visitas: levels ? num(levels.used) : null,
      actualizado: levels ? optionalString(levels.updated_at) : null,
    };
  });
}

async function consultarStock(context: ToolContext, input: Row): Promise<ToolOutcome> {
  const search = optionalString(input.busqueda)?.slice(0, 80) ?? '';
  const items = await loadStock(context.db);
  const matches = search
    ? items.filter((item) => matchesAllWords(search, `${item.nombre} ${item.codigo}`))
    : [...items].sort(
        (a, b) =>
          Number(b.bajo_minimo) - Number(a.bajo_minimo) ||
          Number(b.sin_conteo_inicial) - Number(a.sin_conteo_inicial),
      );
  return ok({
    materiales_activos: items.length,
    bajo_minimo: items.filter((item) => item.bajo_minimo).length,
    sin_conteo_inicial: items.filter((item) => item.sin_conteo_inicial).length,
    busqueda: search || null,
    coincidencias: matches.length,
    materiales: matches.slice(0, MAX_STOCK_ITEMS),
    nota: 'en_bodega null con sin_conteo_inicial = nunca se registró una compra ni un ajuste: no se sabe cuánto hay; usado_en_visitas sí es real. Oficina o administración deben registrar un ajuste con lo que hay en bodega. en_bodega null sin esa marca = el servidor aún no tiene existencias de ese material. stock_negativo = se usó más de lo que entró: hay que revisar el conteo. Cantidades en la unidad indicada.',
  });
}

async function sugerenciasCompra(context: ToolContext): Promise<ToolOutcome> {
  const items = await loadStock(context.db);
  const low = items.filter((item) => item.comprar_sugerido !== null);
  return ok({
    por_comprar: low.length,
    sugerencias: low.slice(0, MAX_SUGGESTIONS).map((item) => ({
      codigo: item.codigo,
      nombre: item.nombre,
      unidad: item.unidad,
      en_bodega: item.en_bodega,
      minimo: item.minimo,
      comprar: item.comprar_sugerido,
    })),
    materiales_sin_minimo: items.filter((item) => item.minimo === null).length,
    sin_conteo_inicial: items
      .filter(
        (item) =>
          item.sin_conteo_inicial && (item.minimo !== null || (item.usado_en_visitas ?? 0) !== 0),
      )
      .slice(0, MAX_SUGGESTIONS)
      .map((item) => ({
        codigo: item.codigo,
        nombre: item.nombre,
        unidad: item.unidad,
        minimo: item.minimo,
        usado_en_visitas: item.usado_en_visitas,
      })),
    nota: 'Los materiales sin mínimo definido no se evalúan. Los de sin_conteo_inicial no tienen compras ni ajustes: no se puede calcular cuánto comprar hasta registrar un ajuste con lo que hay en bodega.',
  });
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha local AAAA-MM-DD → instante UTC del inicio (o del final) de ese día. */
export function localDayToUtc(
  text: string,
  timezoneOffsetMinutes: number,
  endOfDay: boolean,
): Date | null {
  const match = DATE.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = endOfDay
    ? Date.UTC(year, month - 1, day, 23, 59, 59, 999)
    : Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const date = new Date(utc + timezoneOffsetMinutes * 60_000);
  // Rechaza fechas imposibles (31 de febrero).
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return date;
}

async function consumoMateriales(context: ToolContext, input: Row): Promise<ToolOutcome> {
  const from = localDayToUtc(str(input.desde), context.timezoneOffsetMinutes, false);
  const to = localDayToUtc(str(input.hasta), context.timezoneOffsetMinutes, true);
  if (!from || !to) return fail('Las fechas deben tener el formato AAAA-MM-DD.');
  if (from > to) return fail('La fecha "desde" es posterior a "hasta".');
  if (to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) {
    return fail('El rango máximo es de un año.');
  }
  const f = from.toISOString();
  const t = to.toISOString();
  const visits = await run(
    context.db
      .from('visits')
      .select('id')
      .or(
        `and(completed_at.gte.${f},completed_at.lte.${t}),and(completed_at.is.null,created_at.gte.${f},created_at.lte.${t})`,
      )
      .limit(MAX_RANGE_VISITS),
  );
  const visitIds = visits.map((row) => str(row.id)).filter(Boolean);
  const totals = new Map<
    string,
    { codigo: string; nombre: string; unidad: string; cantidad: number; visitas: Set<string> }
  >();
  for (let index = 0; index < visitIds.length; index += ID_CHUNK) {
    const rows = await run(
      context.db
        .from('visit_materials')
        .select('material_id, material_code, material_name, unit, quantity, visit_id')
        .eq('is_custom', false)
        .in('visit_id', visitIds.slice(index, index + ID_CHUNK)),
    );
    for (const row of rows) {
      const id = str(row.material_id);
      if (!id) continue;
      const entry = totals.get(id) ?? {
        codigo: str(row.material_code),
        nombre: str(row.material_name),
        unidad: str(row.unit),
        cantidad: 0,
        visitas: new Set<string>(),
      };
      entry.cantidad = round3(entry.cantidad + (num(row.quantity) ?? 0));
      entry.visitas.add(str(row.visit_id));
      totals.set(id, entry);
    }
  }
  const materials = [...totals.values()]
    .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre))
    .map(({ visitas, ...rest }) => ({ ...rest, visitas: visitas.size }));
  return ok({
    desde: str(input.desde),
    hasta: str(input.hasta),
    visitas_en_rango: visitIds.length,
    materiales_distintos: materials.length,
    materiales: materials.slice(0, MAX_CONSUMPTION_ITEMS),
    nota: 'Solo materiales del catálogo de las visitas que el usuario puede ver. Los personalizados no cuentan.',
  });
}

// ── Visitas ──────────────────────────────────────────────────────────────────

/** Roles que reciben todas las visitas en el teléfono (como la RLS de lectura). */
const SEES_ALL_ROLES: ReadonlySet<string> = new Set(['admin', 'office']);

const VISIT_COLUMNS =
  'id, title, client_name, address, visit_type, status, created_at, started_at, completed_at, technician_id';

function visitsQuery(context: ToolContext, state: VisitState, limit: number): PgQuery {
  let query = context.db.from('visits').select(VISIT_COLUMNS);
  const statuses = STATUS_FILTER[state];
  if (statuses) query = query.in('status', statuses);
  return query.order('created_at', { ascending: false }).limit(limit);
}

/** Visitas que coinciden con la búsqueda (con o sin tildes), las más recientes primero. */
async function searchVisitRows(
  context: ToolContext,
  search: string,
  state: VisitState,
): Promise<Row[]> {
  let rows: Row[];
  if (search) {
    const pattern = `*${search}*`;
    rows = await run(
      visitsQuery(context, state, MAX_VISITS).or(
        `title.ilike.${pattern},client_name.ilike.${pattern},address.ilike.${pattern}`,
      ),
    );
    if (rows.length === 0) {
      // Sin tildes ni errores de tecleo: se busca en las más recientes.
      const recent = await run(visitsQuery(context, state, 300));
      rows = recent
        .filter((row) =>
          matchesAllWords(search, `${str(row.title)} ${str(row.client_name)} ${str(row.address)}`),
        )
        .slice(0, MAX_VISITS);
    }
  } else {
    rows = await run(visitsQuery(context, state, MAX_VISITS));
  }
  return rows;
}

/** Nombres de los técnicos de las visitas que no son del usuario. */
async function technicianNames(context: ToolContext, rows: readonly Row[]) {
  const technicianIds = [...new Set(rows.map((row) => str(row.technician_id)).filter(Boolean))];
  const names = new Map<string, string>();
  if (technicianIds.some((id) => id !== context.userId)) {
    const profiles = await run(
      context.db.from('profiles').select('id, full_name, email').in('id', technicianIds),
    );
    for (const profile of profiles) {
      names.set(str(profile.id), optionalString(profile.full_name) ?? str(profile.email));
    }
  }
  return names;
}

/** Resumen de una visita para Claude (con el técnico si no es del usuario). */
function visitSummary(context: ToolContext, row: Row, names: ReadonlyMap<string, string>) {
  const technicianId = str(row.technician_id);
  return {
    id: str(row.id),
    titulo: str(row.title),
    cliente: optionalString(row.client_name),
    direccion: optionalString(row.address),
    tipo: str(row.visit_type),
    estado: STATUS_LABELS[str(row.status)] ?? str(row.status),
    creada: optionalString(row.created_at),
    iniciada: optionalString(row.started_at),
    finalizada: optionalString(row.completed_at),
    es_del_usuario: technicianId === context.userId,
    ...(technicianId !== context.userId ? { tecnico: names.get(technicianId) ?? null } : {}),
  };
}

async function buscarVisitas(context: ToolContext, input: Row): Promise<ToolOutcome> {
  const rawState = str(input.estado);
  const state: VisitState = (VISIT_STATES as readonly string[]).includes(rawState)
    ? (rawState as VisitState)
    : 'todas';
  const search = sanitizeSearch(str(input.busqueda));
  const rows = await searchVisitRows(context, search, state);
  const names = await technicianNames(context, rows);
  return ok({
    busqueda: search || null,
    estado: state,
    mostradas: rows.length,
    visitas: rows.map((row) => visitSummary(context, row, names)),
  });
}

const VISIT_ID = /^[0-9a-fA-F-]{8,64}$/;

/** Una visita por id (la RLS decide si el usuario puede verla). */
async function visitById(context: ToolContext, visitId: string): Promise<Row | null> {
  const { data, error } = await context.db
    .from('visits')
    .select(VISIT_COLUMNS)
    .eq('id', visitId)
    .maybeSingle();
  if (error) throw new ToolError(`Error de la base de datos: ${error.message}`);
  return typeof data === 'object' && data !== null ? (data as Row) : null;
}

async function materialesDeVisita(context: ToolContext, input: Row): Promise<ToolOutcome> {
  const visitId = str(input.visit_id).trim();
  const search = sanitizeSearch(str(input.busqueda));
  const materialSearch = optionalString(input.material)?.slice(0, 80) ?? '';
  let visit: Row | null = null;
  if (visitId) {
    if (!VISIT_ID.test(visitId)) {
      return fail('visit_id no es un id de visita válido. Obtén el id con buscar_visitas.');
    }
    visit = await visitById(context, visitId);
    if (!visit) return fail('No existe esa visita o el usuario no tiene permiso para verla.');
  } else if (search) {
    const rows = await searchVisitRows(context, search, 'todas');
    if (rows.length === 0) {
      return ok({ encontradas: 0, busqueda: search, nota: 'No hay visitas que coincidan.' });
    }
    if (rows.length > 1) {
      const names = await technicianNames(context, rows);
      return ok({
        encontradas: rows.length,
        busqueda: search,
        visitas: rows.map((row) => visitSummary(context, row, names)),
        nota: 'Varias visitas coinciden: pregunta al usuario cuál (cliente, título y fecha) y vuelve a llamar con su visit_id.',
      });
    }
    visit = rows[0] ?? null;
  } else {
    return fail('Indica visit_id o busqueda (cliente o título de la visita).');
  }

  const id = str(visit?.id);
  const rows = await run(
    context.db
      .from('visit_materials')
      .select('material_id, is_custom, material_code, material_name, unit, quantity, created_at')
      .eq('visit_id', id)
      .order('created_at', { ascending: true })
      .limit(MAX_VISIT_MATERIALS),
  );
  const materials = rows.map((row) => ({
    codigo: optionalString(row.material_code),
    nombre: str(row.material_name),
    unidad: str(row.unit),
    cantidad: round3(num(row.quantity) ?? 0),
    personalizado: row.is_custom === true || row.is_custom === 1 || row.is_custom === 'true',
  }));
  const filtered = materialSearch
    ? materials.filter((item) =>
        matchesAllWords(materialSearch, `${item.nombre} ${item.codigo ?? ''}`),
      )
    : materials;
  const names = visit ? await technicianNames(context, [visit]) : new Map<string, string>();
  return ok({
    visita: visit ? visitSummary(context, visit, names) : null,
    material_buscado: materialSearch || null,
    material_encontrado: materialSearch ? filtered.length > 0 : null,
    materiales: materialSearch && filtered.length > 0 ? filtered : materials,
    total_registrados: materials.length,
    nota: 'Cantidades tal como se registraron en la visita. personalizado = material que no es del catálogo de bodega. Si material_encontrado es false, el material buscado no está en la visita y se listan todos.',
  });
}

const visitTime = (row: Row) =>
  new Date(str(row.completed_at) || str(row.created_at)).getTime() || 0;

async function usoMaterialPorVisita(context: ToolContext, input: Row): Promise<ToolOutcome> {
  const search = optionalString(input.material)?.slice(0, 80) ?? '';
  if (!search) return fail('Indica el material (nombre o código).');
  const catalog = await run(
    context.db
      .from('material_catalog')
      .select('id, code, name, unit')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(MAX_CATALOG),
  );
  const exact = catalog.filter(
    (row) =>
      normalizeText(str(row.code)).replace(/ /g, '') === normalizeText(search).replace(/ /g, ''),
  );
  const matches =
    exact.length > 0
      ? exact
      : catalog.filter((row) => matchesAllWords(search, `${str(row.name)} ${str(row.code)}`));
  if (matches.length === 0) return ok({ encontrado: false, busqueda: search });
  if (matches.length > 1) {
    return ok({
      encontrado: false,
      varios: matches.slice(0, 10).map((row) => ({ codigo: str(row.code), nombre: str(row.name) })),
      nota: 'Varios materiales coinciden: pregunta cuál (o usa su código).',
    });
  }
  const material = matches[0] as Row;
  const uses = await run(
    context.db
      .from('visit_materials')
      .select('visit_id, quantity')
      .eq('material_id', str(material.id))
      .eq('is_custom', false)
      .limit(MAX_USAGE_ROWS),
  );
  const perVisit = new Map<string, number>();
  for (const row of uses) {
    const visitId = str(row.visit_id);
    if (visitId)
      perVisit.set(visitId, round3((perVisit.get(visitId) ?? 0) + (num(row.quantity) ?? 0)));
  }
  const ids = [...perVisit.keys()];
  const visits: Row[] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    visits.push(
      ...(await run(
        context.db
          .from('visits')
          .select(VISIT_COLUMNS)
          .in('id', ids.slice(index, index + ID_CHUNK)),
      )),
    );
  }
  visits.sort((a, b) => visitTime(b) - visitTime(a));
  const shown = visits.slice(0, MAX_USAGE_VISITS);
  const names = await technicianNames(context, shown);
  const total = round3(visits.reduce((sum, row) => sum + (perVisit.get(str(row.id)) ?? 0), 0));
  return ok({
    encontrado: true,
    material: {
      codigo: str(material.code),
      nombre: str(material.name),
      unidad: str(material.unit),
    },
    visitas_con_uso: visits.length,
    total,
    visitas: shown.map((row) => ({
      ...visitSummary(context, row, names),
      cantidad: perVisit.get(str(row.id)) ?? 0,
    })),
    nota: 'Una fila por visita (cantidad de esa visita, sin sumar entre visitas), de la más reciente a la más antigua. Solo visitas que el usuario puede ver; los materiales personalizados no cuentan.',
  });
}

async function generarPdfVisita(context: ToolContext, input: Row): Promise<ToolOutcome> {
  const visitId = str(input.visit_id).trim();
  if (!VISIT_ID.test(visitId)) {
    return fail('visit_id no es un id de visita válido. Obtén el id con buscar_visitas.');
  }
  const row = await visitById(context, visitId);
  if (!row) return fail('No existe esa visita o el usuario no tiene permiso para verla.');
  // Admin y oficina tienen todas las visitas en el teléfono (stream
  // visitas_de_oficina); el técnico, solo las suyas.
  if (str(row.technician_id) !== context.userId && !SEES_ALL_ROLES.has(context.role)) {
    return fail(
      'El PDF se genera en el teléfono con los datos guardados en él, y en el teléfono de un técnico solo están sus visitas. Esta visita es de otro técnico: el PDF debe generarlo él (o oficina) desde la app (botón «Compartir PDF» de la visita).',
    );
  }
  const title = str(row.title);
  const client = optionalString(row.client_name);
  const label = client ? `${client} — ${title}` : title;
  return {
    content: JSON.stringify({
      listo: true,
      mensaje:
        'La app mostrará el botón «Compartir PDF» para esta visita: el PDF se genera en el teléfono (también sin conexión) y se comparte desde ahí.',
      visita: label,
    }),
    isError: false,
    action: { type: 'share_pdf', visitId: str(row.id), label },
  };
}

// ── Guía ─────────────────────────────────────────────────────────────────────

/** Tema de la guía por id o por palabras clave. */
export function findGuideTopic(guide: GuideJson, query: string): GuideTopicJson | null {
  const normalized = normalizeText(query);
  const byId = guide.topics.find((topic) => topic.id === query.trim() || topic.id === normalized);
  if (byId) return byId;
  const words = tokenize(query);
  let best: GuideTopicJson | null = null;
  let bestScore = 0;
  for (const topic of guide.topics) {
    let score = 0;
    for (const keyword of topic.keywords) {
      if (keyword.includes(' ')) {
        if (` ${normalized} `.includes(` ${keyword} `)) score += 3;
      } else if (words.some((word) => wordMatches(word, keyword))) {
        score += 2;
      }
    }
    if (matchesAllWords(query, topic.title)) score += 1;
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return best;
}

function guiaUso(context: ToolContext, input: Row): ToolOutcome {
  const topics = context.guide.topics.map((topic) => ({
    id: topic.id,
    titulo: topic.title,
    resumen: topic.summary,
  }));
  const query = optionalString(input.tema);
  if (!query) return ok({ temas: topics });
  const topic = findGuideTopic(context.guide, query);
  if (!topic) return ok({ encontrado: false, temas: topics });
  const role = context.role as GuideRole;
  return ok({
    encontrado: true,
    id: topic.id,
    titulo: topic.title,
    pasos: topic.steps,
    notas: topic.notes ?? [],
    nota_para_el_rol: topic.roles?.[role] ?? null,
  });
}

// ── Entrada ──────────────────────────────────────────────────────────────────

/** Ejecuta una herramienta. Nunca lanza: los fallos vuelven como `isError`. */
export async function executeTool(
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<ToolOutcome> {
  const args: Row = typeof input === 'object' && input !== null ? (input as Row) : {};
  try {
    switch (name) {
      case 'consultar_stock':
        return await consultarStock(context, args);
      case 'sugerencias_compra':
        return await sugerenciasCompra(context);
      case 'consumo_materiales':
        return await consumoMateriales(context, args);
      case 'buscar_visitas':
        return await buscarVisitas(context, args);
      case 'guia_uso':
        return guiaUso(context, args);
      case 'generar_pdf_visita':
        return await generarPdfVisita(context, args);
      case 'materiales_de_visita':
        return await materialesDeVisita(context, args);
      case 'uso_material_por_visita':
        return await usoMaterialPorVisita(context, args);
      default:
        return fail(`Herramienta desconocida: ${name}.`);
    }
  } catch (error) {
    return fail(
      error instanceof ToolError ? error.message : 'No se pudo consultar la base de datos.',
    );
  }
}
