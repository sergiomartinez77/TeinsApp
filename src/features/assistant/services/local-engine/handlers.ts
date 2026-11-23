import {
  GUIDE_TOPICS,
  type GuideRole,
  type GuideTopic,
} from '@/features/assistant/knowledge/guide';
import {
  getConsumption,
  getPurchaseSuggestions,
  getStockSummary,
  type InventoryReader,
} from '@/features/inventory/services/inventory.service';
import { findVisitsForReport, type ReportDatabase } from '@/features/reports';
import { buildVisitListQuery } from '@/features/visits/services/visit.queries';
import { suggestedPurchaseQuantity, type MaterialStockItem } from '@/models/inventory.model';
import type { UserRole } from '@/models/user.model';
import {
  FINISHED_STATUSES,
  VISIT_STATUS_LABELS,
  visitFromRow,
  type Visit,
} from '@/models/visit.model';
import { formatShortDate } from '@/utils/date.utils';
import { formatQuantity } from '@/utils/number.utils';

import {
  DEFAULT_SUGGESTIONS,
  suggestion,
  type AssistantAction,
  type AssistantContext,
} from '../engine';
import { contentWords } from '../text';

import type { Intent, VisitFilterIntent } from './intents';
import { matchGuideTopic, matchMaterials, matchVisits, type CatalogEntry } from './match';
import { currentMonth, MONTH_NAMES, parsePeriod } from './periods';
import {
  ACTIVE_CATALOG_SQL,
  PENDING_VISITS_COUNT_SQL,
  PENDING_VISITS_SQL,
  VISIT_BY_ID_SQL,
  VISITS_ACTIVE_IN_RANGE_SQL,
} from './queries';

/**
 * Respuestas del asistente básico. Cada una sale de las APIs reales de la app
 * (inventario, informes, visitas) sobre la base local, o de la guía de uso.
 * Si un dato no está en el teléfono, se dice; nunca se inventa.
 */

/** Lecturas de la base local que usa el asistente (subconjunto de PowerSync). */
export type AssistantDatabase = InventoryReader & ReportDatabase;

export interface LocalAnswer {
  readonly text: string;
  readonly actions: readonly AssistantAction[];
}

type Row = Record<string, unknown>;

export const LOCAL_MESSAGES = {
  databaseError:
    'No pude leer los datos guardados en el teléfono. Intenta nuevamente en un momento.',
  syncNote: 'Datos de la última sincronización con el servidor.',
  deviceScope: 'Solo cuenta las visitas guardadas en este teléfono.',
  notUnderstood:
    'No entendí tu pregunta. Puedo consultar existencias, decirte qué comprar, el consumo de materiales, tus visitas, generar el PDF de una visita o explicarte cómo usar la app.',
} as const;

const MAX_LIST = 8;
const MAX_VISIT_CANDIDATES = 300;
const OPEN_INVENTORY: AssistantAction = { type: 'open_inventory' };

const qty = (value: number, unit: string) => `${formatQuantity(value)} ${unit}`.trim();
const bullet = (lines: readonly string[]) => lines.map((line) => `• ${line}`).join('\n');
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// ── Visitas ──────────────────────────────────────────────────────────────────

/** "Cliente — Título (12 nov 2026)" o "Título (12 nov 2026)". */
export function visitLabel(visit: Visit): string {
  const date = formatShortDate(visit.completedAt ?? visit.startedAt ?? visit.createdAt);
  const name = visit.clientName ? `${visit.clientName} — ${visit.title}` : visit.title;
  return date ? `${name} (${date})` : name;
}

const visitLine = (visit: Visit) => `${visitLabel(visit)} · ${VISIT_STATUS_LABELS[visit.status]}`;

const shareAction = (visit: Visit): AssistantAction => ({
  type: 'share_pdf',
  visitId: visit.id,
  label: visitLabel(visit),
});

const selectAction = (visit: Visit): AssistantAction => ({
  type: 'select_visit',
  visitId: visit.id,
  label: visitLabel(visit),
});

async function loadVisits(db: AssistantDatabase, technicianId: string): Promise<Visit[] | null> {
  const result = await findVisitsForReport(db, { technicianId, limit: MAX_VISIT_CANDIDATES });
  return result.ok ? result.data : null;
}

/** Respuesta con el PDF de una visita concreta (al elegirla en la lista). */
export async function answerVisitChoice(
  db: AssistantDatabase,
  context: AssistantContext,
  visitId: string,
): Promise<LocalAnswer> {
  try {
    const row = await db.getOptional<Row>(VISIT_BY_ID_SQL, [visitId, context.user.id]);
    if (!row) {
      return {
        text: 'Esa visita ya no está en este teléfono. Busca otra por cliente o título.',
        actions: [],
      };
    }
    const visit = visitFromRow(row);
    return {
      text: `Listo. Toca «Compartir PDF» para generar el informe de ${visitLabel(visit)} y enviarlo.`,
      actions: [shareAction(visit)],
    };
  } catch {
    return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  }
}

async function answerPdf(
  db: AssistantDatabase,
  context: AssistantContext,
  words: readonly string[],
): Promise<LocalAnswer> {
  const visits = await loadVisits(db, context.user.id);
  if (!visits) return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  if (visits.length === 0) {
    return { text: 'No hay visitas guardadas en este teléfono para generar un PDF.', actions: [] };
  }
  const recent = visits.slice(0, 4).map(selectAction);
  if (words.length === 0) {
    return {
      text: '¿De qué visita quieres el PDF? Escribe el cliente o el título (por ejemplo «PDF de la visita de Clínica Sur») o elige una reciente:',
      actions: recent,
    };
  }
  const matches = matchVisits(words, visits);
  const searched = words.join(' ');
  const [first] = matches;
  if (!first) {
    return {
      text: `No encontré visitas que coincidan con «${searched}» en este teléfono. Prueba con otro nombre o elige una reciente:`,
      actions: recent,
    };
  }
  if (matches.length === 1) {
    return {
      text: `Encontré la visita ${visitLabel(first)}. Toca «Compartir PDF» para generar el informe (funciona sin conexión) y enviarlo.`,
      actions: [shareAction(first)],
    };
  }
  const shown = matches.slice(0, 6);
  return {
    text: `Encontré ${matches.length} visitas que coinciden con «${searched}». ¿Cuál quieres?${
      matches.length > shown.length ? ` (muestro las ${shown.length} más recientes)` : ''
    }`,
    actions: shown.map(selectAction),
  };
}

const FILTER_STATUSES: Readonly<Record<VisitFilterIntent, readonly string[] | null>> = {
  pending: ['assigned', 'inProgress'],
  inProgress: ['inProgress'],
  assigned: ['assigned'],
  completed: FINISHED_STATUSES,
  today: null,
  all: null,
};

const FILTER_TITLES: Readonly<Record<VisitFilterIntent, string>> = {
  pending: 'pendientes (asignadas o en progreso)',
  inProgress: 'en progreso',
  assigned: 'asignadas',
  completed: 'completadas',
  today: 'con actividad hoy (creadas, iniciadas o finalizadas)',
  all: 'guardadas en este teléfono',
};

function listVisits(visits: readonly Visit[], title: string, total = visits.length): string {
  const shown = visits.slice(0, MAX_LIST);
  const more = total > shown.length ? `\n…y ${total - shown.length} más en «Mis visitas».` : '';
  return `Tienes ${plural(total, 'visita', 'visitas')} ${title}:\n${bullet(shown.map(visitLine))}${more}`;
}

/** Sugerencias "PDF: <cliente>" de las primeras visitas (sin repetir nombres). */
function pdfSuggestions(visits: readonly Visit[]): AssistantAction[] {
  const names = [...new Set(visits.map((visit) => visit.clientName ?? visit.title))];
  return names.slice(0, 2).map((name) => suggestion(`PDF: ${name}`, `PDF de la visita ${name}`));
}

async function answerVisits(
  db: AssistantDatabase,
  context: AssistantContext,
  filter: VisitFilterIntent,
  words: readonly string[],
): Promise<LocalAnswer> {
  const technicianId = context.user.id;
  try {
    if (words.length > 0) {
      const visits = await loadVisits(db, technicianId);
      if (!visits) return { text: LOCAL_MESSAGES.databaseError, actions: [] };
      const statuses = FILTER_STATUSES[filter];
      const matches = matchVisits(words, visits).filter(
        (visit) => !statuses || statuses.includes(visit.status),
      );
      const searched = words.join(' ');
      if (matches.length === 0) {
        return {
          text: `No encontré visitas ${filter === 'all' ? '' : `${FILTER_TITLES[filter]} `}que coincidan con «${searched}» en este teléfono.`,
          actions: [suggestion('Visitas pendientes', '¿Qué visitas tengo pendientes?')],
        };
      }
      return {
        text: listVisits(matches, `que coinciden con «${searched}»`),
        actions: pdfSuggestions(matches),
      };
    }

    if (filter === 'today') {
      const from = new Date(
        context.now.getFullYear(),
        context.now.getMonth(),
        context.now.getDate(),
      );
      const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
      const range = [from.toISOString(), to.toISOString()];
      const rows = await db.getAll<Row>(VISITS_ACTIVE_IN_RANGE_SQL, [
        technicianId,
        ...range,
        ...range,
        ...range,
        50,
      ]);
      const visits = rows.map(visitFromRow);
      if (visits.length === 0) {
        return {
          text: 'Hoy no hay visitas creadas, iniciadas ni finalizadas en este teléfono.',
          actions: [suggestion('Visitas pendientes', '¿Qué visitas tengo pendientes?')],
        };
      }
      return { text: listVisits(visits, FILTER_TITLES.today), actions: pdfSuggestions(visits) };
    }

    if (filter === 'pending' || filter === 'all') {
      const [counts, rows] = await Promise.all([
        db.getOptional<Row>(PENDING_VISITS_COUNT_SQL, [technicianId]),
        db.getAll<Row>(PENDING_VISITS_SQL, [technicianId, MAX_LIST]),
      ]);
      const assigned = Number(counts?.assigned ?? 0);
      const inProgress = Number(counts?.in_progress ?? 0);
      const completed = Number(counts?.completed ?? 0);
      const total = assigned + inProgress;
      const summary = `Por hacer: ${plural(inProgress, 'en progreso', 'en progreso')} y ${plural(assigned, 'asignada', 'asignadas')}. Completadas: ${completed}.`;
      if (total === 0) {
        return {
          text: `No tienes visitas pendientes. ${summary}`,
          actions: [suggestion('Visitas completadas', 'Visitas completadas')],
        };
      }
      const visits = rows.map(visitFromRow);
      return {
        text: `${listVisits(visits, FILTER_TITLES.pending, total)}\n${summary}`,
        actions: pdfSuggestions(visits),
      };
    }

    const query = buildVisitListQuery(technicianId, {
      filter,
      search: '',
      limit: 50,
    });
    const visits = (await db.getAll<Row>(query.sql, query.parameters)).map(visitFromRow);
    if (visits.length === 0) {
      return { text: `No tienes visitas ${FILTER_TITLES[filter]}.`, actions: [] };
    }
    return { text: listVisits(visits, FILTER_TITLES[filter]), actions: pdfSuggestions(visits) };
  } catch {
    return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  }
}

// ── Inventario ───────────────────────────────────────────────────────────────

/** Una línea con las existencias de un material. */
export function stockLine(item: MaterialStockItem): string {
  const name = item.code ? `${item.name} (${item.code})` : item.name;
  if (!item.stock) {
    return `${name}: todavía no llegaron sus existencias a este teléfono (se descargan al sincronizar).`;
  }
  const minimum =
    item.minStock === null ? 'sin mínimo definido' : `mínimo ${qty(item.minStock, item.unit)}`;
  let line = `${name}: ${qty(item.stock.onHand, item.unit)} en bodega; ${minimum}.`;
  const suggested = suggestedPurchaseQuantity(item);
  if (suggested !== null)
    line += ` Está bajo mínimo: conviene comprar ${qty(suggested, item.unit)}.`;
  if (item.hasPending) line += ' Hay cambios de este teléfono aún sin sincronizar.';
  return line;
}

async function loadCatalog(db: AssistantDatabase): Promise<CatalogEntry[]> {
  const rows = await db.getAll<Row>(ACTIVE_CATALOG_SQL);
  return rows.map((row) => ({
    id: String(row.id),
    code: typeof row.code === 'string' ? row.code : '',
    name: typeof row.name === 'string' ? row.name : '',
    unit: typeof row.unit === 'string' ? row.unit : '',
  }));
}

async function stockOfMaterials(
  db: AssistantDatabase,
  materials: readonly CatalogEntry[],
): Promise<LocalAnswer> {
  const ids = new Set(materials.map((material) => material.id));
  // Una sola lectura con la API del inventario; se filtra por los encontrados.
  const items = (await getStockSummary(db)).filter((item) => ids.has(item.materialId));
  const intro = items.length === 1 ? '' : `Encontré ${items.length} materiales que coinciden:\n`;
  const body =
    items.length === 1 ? stockLine(items[0] as MaterialStockItem) : bullet(items.map(stockLine));
  return { text: `${intro}${body}\n${LOCAL_MESSAGES.syncNote}`, actions: [OPEN_INVENTORY] };
}

async function answerStock(db: AssistantDatabase, words: readonly string[]): Promise<LocalAnswer> {
  try {
    if (words.length > 0) {
      const materials = matchMaterials(words, await loadCatalog(db));
      if (materials.length > 0) return await stockOfMaterials(db, materials);
      return {
        text: `No encontré «${words.join(' ')}» en el catálogo de materiales. Prueba con el código o con otra parte del nombre.`,
        actions: [OPEN_INVENTORY, suggestion('¿Qué tengo que comprar?')],
      };
    }
    const items = await getStockSummary(db);
    if (items.length === 0) {
      return {
        text: 'Aún no hay materiales del catálogo en este teléfono. Se descargan al sincronizar con conexión.',
        actions: [],
      };
    }
    const low = items.filter((item) => item.isLow);
    const withoutStock = items.filter((item) => !item.stock).length;
    const lines = [
      `Hay ${plural(items.length, 'material activo', 'materiales activos')} en el catálogo; ${plural(low.length, 'está', 'están')} bajo mínimo.`,
    ];
    if (low.length > 0) lines.push(bullet(low.slice(0, 5).map(stockLine)));
    if (withoutStock > 0) {
      lines.push(
        `${plural(withoutStock, 'material aún no tiene', 'materiales aún no tienen')} existencias en el teléfono.`,
      );
    }
    lines.push('Pregúntame por un material concreto, por ejemplo «¿cuánto cable queda?».');
    lines.push(LOCAL_MESSAGES.syncNote);
    return { text: lines.join('\n'), actions: [OPEN_INVENTORY] };
  } catch {
    return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  }
}

async function answerPurchase(
  db: AssistantDatabase,
  words: readonly string[],
): Promise<LocalAnswer> {
  try {
    if (words.length > 0) {
      const materials = matchMaterials(words, await loadCatalog(db));
      if (materials.length > 0) return await stockOfMaterials(db, materials);
    }
    const [suggestions, items] = await Promise.all([
      getPurchaseSuggestions(db),
      getStockSummary(db),
    ]);
    const withoutMinimum = items.filter((item) => item.minStock === null).length;
    const note =
      withoutMinimum > 0
        ? `\n${plural(withoutMinimum, 'material no tiene', 'materiales no tienen')} mínimo definido y no se evalúan.`
        : '';
    if (suggestions.length === 0) {
      return {
        text: `Nada por comprar: ningún material está bajo su mínimo.${note}\n${LOCAL_MESSAGES.syncNote}`,
        actions: [OPEN_INVENTORY],
      };
    }
    const lines = suggestions.map(({ item, suggestedQuantity }) => {
      const onHand = item.stock ? qty(item.stock.onHand, item.unit) : '—';
      const minimum = item.minStock === null ? '—' : qty(item.minStock, item.unit);
      return `${item.name} (${item.code}): comprar ${qty(suggestedQuantity, item.unit)} (hay ${onHand}; mínimo ${minimum})`;
    });
    return {
      text: `Para volver al mínimo conviene comprar:\n${bullet(lines)}${note}\n${LOCAL_MESSAGES.syncNote}`,
      actions: [OPEN_INVENTORY],
    };
  } catch {
    return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  }
}

/** Palabras que forman parte del periodo y no del nombre del material. */
const PERIOD_WORDS = [
  ...MONTH_NAMES,
  'setiembre',
  'hoy',
  'ayer',
  'anteayer',
  'antier',
  'semana',
  'pasada',
  'pasado',
  'anterior',
  'mes',
  'ano',
  'ultimo',
  'ultimos',
  'dias',
  'dia',
  'desde',
  'hasta',
  'entre',
  'durante',
  'periodo',
];

async function answerConsumption(
  db: AssistantDatabase,
  context: AssistantContext,
  text: string,
  words: readonly string[],
): Promise<LocalAnswer> {
  const period = parsePeriod(text, context.now) ?? currentMonth(context.now);
  const materialWords = contentWords(words, PERIOD_WORDS).filter((word) => !/^\d{1,4}$/.test(word));
  try {
    let rows = await getConsumption(db, { from: period.from, to: period.to });
    let subject = 'materiales del catálogo';
    if (materialWords.length > 0) {
      const materials = matchMaterials(materialWords, await loadCatalog(db));
      if (materials.length === 0) {
        return {
          text: `No encontré «${materialWords.join(' ')}» en el catálogo de materiales.`,
          actions: [suggestion('Consumo de este mes', '¿Cuánto material se consumió este mes?')],
        };
      }
      const ids = new Set(materials.map((material) => material.id));
      rows = rows.filter((row) => ids.has(row.materialId));
      subject = materials.length === 1 ? `«${materials[0]?.name ?? ''}»` : 'esos materiales';
    }
    if (rows.length === 0) {
      return {
        text: `No se registró consumo de ${subject} ${period.label}. ${LOCAL_MESSAGES.deviceScope}`,
        actions: [],
      };
    }
    const shown = rows.slice(0, 10);
    const lines = shown.map(
      (row) =>
        `${row.name} (${row.code}): ${qty(row.quantity, row.unit)} en ${plural(row.visitCount, 'visita', 'visitas')}`,
    );
    const more =
      rows.length > shown.length ? `\n…y ${rows.length - shown.length} materiales más.` : '';
    return {
      text: `Consumo de ${subject} ${period.label}:\n${bullet(lines)}${more}\n${LOCAL_MESSAGES.deviceScope} Los materiales personalizados no cuentan.`,
      actions: [OPEN_INVENTORY],
    };
  } catch {
    return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  }
}

// ── Guía y ayuda ─────────────────────────────────────────────────────────────

const guideRole = (role: UserRole): GuideRole | null =>
  role === 'technician' || role === 'office' || role === 'admin' ? role : null;

/** Tema de la guía como texto paso a paso. */
export function formatGuideTopic(topic: GuideTopic, role: UserRole): string {
  const steps = topic.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  const parts = [`${topic.title}\n${steps}`];
  if (topic.notes?.length) parts.push(bullet(topic.notes));
  const key = guideRole(role);
  const roleNote = key ? topic.roles?.[key] : undefined;
  if (roleNote) parts.push(roleNote);
  return parts.join('\n\n');
}

const topicSuggestion = (topic: GuideTopic) =>
  suggestion(`Guía: ${topic.title}`, `¿Cómo funciona ${topic.title.toLowerCase()}?`);

function answerGuide(text: string, context: AssistantContext): LocalAnswer {
  const topic = matchGuideTopic(text, GUIDE_TOPICS);
  if (!topic) {
    return {
      text: 'Te explico paso a paso cualquiera de estos temas. ¿Cuál necesitas?',
      actions: GUIDE_TOPICS.map(topicSuggestion),
    };
  }
  const related = GUIDE_TOPICS.filter((other) => other.id !== topic.id).slice(0, 3);
  return {
    text: formatGuideTopic(topic, context.user.role),
    actions: related.map(topicSuggestion),
  };
}

const HELP_TEXT = [
  'Puedo ayudarte con:',
  bullet([
    'Existencias de un material: «¿cuánto cable queda?»',
    'Qué comprar: «¿qué está bajo mínimo?»',
    'Consumo de materiales: «¿cuánto se usó esta semana?» o «del 1 al 15 de noviembre»',
    'Tus visitas: «visitas pendientes», «visitas de hoy», «visitas de Clínica Sur»',
    'El PDF de una visita: «PDF de la visita de Clínica Sur»',
    'Cómo usar la app: «¿cómo agrego materiales?»',
  ]),
].join('\n');

// ── Entrada ──────────────────────────────────────────────────────────────────

export async function answerIntent(
  db: AssistantDatabase,
  intent: Intent,
  text: string,
  context: AssistantContext,
): Promise<LocalAnswer> {
  switch (intent.kind) {
    case 'greeting':
      return { text: `¡Hola! ${HELP_TEXT}`, actions: DEFAULT_SUGGESTIONS };
    case 'help':
      return { text: HELP_TEXT, actions: DEFAULT_SUGGESTIONS };
    case 'thanks':
      return {
        text: '¡De nada! ¿Te ayudo con algo más?',
        actions: DEFAULT_SUGGESTIONS.slice(0, 3),
      };
    case 'guide':
      return answerGuide(text, context);
    case 'pdf':
      return answerPdf(db, context, intent.words);
    case 'open_inventory':
      return { text: 'Abre el inventario con el botón:', actions: [OPEN_INVENTORY] };
    case 'consumption':
      return answerConsumption(db, context, text, intent.words);
    case 'purchase':
      return answerPurchase(db, intent.words);
    case 'visits':
      return answerVisits(db, context, intent.filter, intent.words);
    case 'stock':
      return answerStock(db, intent.words);
    case 'unknown': {
      if (intent.words.length > 0) {
        try {
          const materials = matchMaterials(intent.words, await loadCatalog(db));
          if (materials.length > 0) return await stockOfMaterials(db, materials);
        } catch {
          return { text: LOCAL_MESSAGES.databaseError, actions: [] };
        }
      }
      return { text: LOCAL_MESSAGES.notUnderstood, actions: DEFAULT_SUGGESTIONS };
    }
  }
}
