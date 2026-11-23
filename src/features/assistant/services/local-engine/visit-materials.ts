import {
  getMaterialUsageByVisit,
  type InventoryReader,
} from '@/features/inventory/services/inventory.service';
import { VISIT_MATERIALS_SQL } from '@/features/materials/services/material.queries';
import { findVisitsForReport, type ReportDatabase } from '@/features/reports';
import { buildVisitByIdQuery } from '@/features/visits/services/visit.queries';
import { visitMaterialFromRow, type VisitMaterial } from '@/models/material.model';
import { VISIT_STATUS_LABELS, visitFromRow, visitScopeFor, type Visit } from '@/models/visit.model';
import { formatShortDate } from '@/utils/date.utils';

import { suggestion, type AssistantAction, type AssistantContext } from '../engine';
import { tokenize, wordsMatch } from '../text';

import { bullet, LOCAL_MESSAGES, plural, qty, selectAction, visitLabel, type Row } from './format';
import type { VisitReference } from './intents';
import { matchMaterials, matchVisits, type CatalogEntry } from './match';
import { ACTIVE_CATALOG_SQL } from './queries';

/**
 * Materiales de UNA visita («¿cuánto cable usé en la visita de Pérez?») y en
 * qué visitas se usó un material («¿en qué visitas se usó cable?»). Todo sale
 * de lo guardado en el teléfono: el técnico ve sus visitas; admin y oficina,
 * todas. Las cantidades son las registradas, visita por visita (nunca se
 * suman visitas distintas).
 */

type Database = InventoryReader & ReportDatabase;

export interface VisitMaterialsAnswer {
  readonly text: string;
  readonly actions: readonly AssistantAction[];
}

const MAX_VISIT_CANDIDATES = 300;
const MAX_CHOICES = 6;
const MAX_USAGE_VISITS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const activityDate = (visit: Visit) => visit.completedAt ?? visit.startedAt ?? visit.createdAt;
const time = (value: string | null) => (value ? new Date(value).getTime() : Number.NaN);

/** Visitas con actividad (creada, iniciada o finalizada) en el día local de `day`. */
function activeOn(visits: readonly Visit[], day: Date): Visit[] {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const to = from + DAY_MS - 1;
  return visits.filter((visit) =>
    [visit.createdAt, visit.startedAt, visit.completedAt].some((value) => {
      const at = time(value);
      return at >= from && at <= to;
    }),
  );
}

/** La más reciente primero (por finalización, inicio o creación). */
const byActivity = (visits: readonly Visit[]) =>
  [...visits].sort((a, b) => time(activityDate(b)) - time(activityDate(a)));

async function loadVisits(db: Database, context: AssistantContext): Promise<Visit[] | null> {
  const result = await findVisitsForReport(db, {
    technicianId: visitScopeFor(context.user),
    limit: MAX_VISIT_CANDIDATES,
  });
  return result.ok ? result.data : null;
}

async function loadCatalog(db: Database): Promise<CatalogEntry[]> {
  const rows = await db.getAll<Row>(ACTIVE_CATALOG_SQL);
  return rows.map((row) => ({
    id: String(row.id),
    code: typeof row.code === 'string' ? row.code : '',
    name: typeof row.name === 'string' ? row.name : '',
    unit: typeof row.unit === 'string' ? row.unit : '',
  }));
}

/** Una línea por material registrado en la visita; los personalizados se marcan. */
export function visitMaterialLine(material: VisitMaterial): string {
  const name = material.materialCode
    ? `${material.materialName} (${material.materialCode})`
    : material.materialName;
  const custom = material.isCustom ? ' — personalizado' : '';
  return `${name}: ${qty(material.quantity, material.unit)}${custom}`;
}

const asEntry = (material: VisitMaterial): CatalogEntry => ({
  id: material.id,
  code: material.materialCode,
  name: material.materialName,
  unit: material.unit,
});

/** Respuesta con los materiales de una visita ya elegida (todos o los que coinciden). */
async function materialsOfVisit(
  db: Database,
  visit: Visit,
  materialWords: readonly string[],
): Promise<VisitMaterialsAnswer> {
  const rows = await db.getAll<Row>(VISIT_MATERIALS_SQL, [visit.id]);
  const materials = rows.map(visitMaterialFromRow);
  const label = visitLabel(visit);
  const status = VISIT_STATUS_LABELS[visit.status].toLowerCase();
  const pending = materials.some((material) => material.syncStatus !== 'synced')
    ? ' Hay materiales de este teléfono aún sin sincronizar.'
    : '';

  if (materials.length === 0) {
    return {
      text: `La visita ${label} (${status}) no tiene materiales registrados.`,
      actions: [],
    };
  }
  const all = `${bullet(materials.map(visitMaterialLine))}`;
  if (materialWords.length === 0) {
    return {
      text: `Materiales registrados en la visita ${label} (${status}):\n${all}${pending}`,
      actions: [],
    };
  }
  const ids = new Set(matchMaterials(materialWords, materials.map(asEntry)).map((e) => e.id));
  const found = materials.filter((material) => ids.has(material.id));
  const searched = materialWords.join(' ');
  if (found.length === 0) {
    return {
      text: `En la visita ${label} no se registró «${searched}». Materiales registrados:\n${all}`,
      actions: [],
    };
  }
  return {
    text: `En la visita ${label} (${status}) se registró:\n${bullet(found.map(visitMaterialLine))}${pending}`,
    actions: [],
  };
}

export interface VisitMaterialsQuestion {
  readonly materialWords: readonly string[];
  readonly visitWords: readonly string[];
  readonly reference: VisitReference | null;
}

const REFERENCE_TEXT: Readonly<Record<VisitReference, string>> = {
  latest: 'reciente',
  today: 'hoy',
  yesterday: 'ayer',
};

/**
 * Separa el material de la visita cuando todo vino detrás de «visita» («en la
 * visita de Pérez, ¿cuánto cable usé?»): las palabras que están en el
 * catálogo y no en ninguna visita son el material.
 */
function splitWords(
  question: VisitMaterialsQuestion,
  visits: readonly Visit[],
  catalog: readonly CatalogEntry[],
): { materialWords: string[]; visitWords: string[] } {
  if (question.materialWords.length > 0 || question.visitWords.length < 2) {
    return { materialWords: [...question.materialWords], visitWords: [...question.visitWords] };
  }
  const materialWords: string[] = [];
  const visitWords: string[] = [];
  // Solo el cliente y el título nombran la visita (la dirección «Calle 1» no
  // debe tragarse un «cable» mal escrito).
  const names = visits.flatMap((visit) => [
    ...tokenize(visit.clientName ?? ''),
    ...tokenize(visit.title),
  ]);
  for (const word of question.visitWords) {
    const isMaterial =
      matchMaterials([word], catalog).length > 0 && !names.some((token) => wordsMatch(word, token));
    (isMaterial ? materialWords : visitWords).push(word);
  }
  return { materialWords, visitWords };
}

/** «¿Cuánto cable usé en la visita de Pérez?», «materiales de la última visita»… */
export async function answerVisitMaterials(
  db: Database,
  context: AssistantContext,
  question: VisitMaterialsQuestion,
): Promise<VisitMaterialsAnswer> {
  try {
    const visits = await loadVisits(db, context);
    if (!visits) return { text: LOCAL_MESSAGES.databaseError, actions: [] };
    if (visits.length === 0) {
      return { text: 'No hay visitas guardadas en este teléfono.', actions: [] };
    }
    const catalog = question.visitWords.length > 1 ? await loadCatalog(db) : [];
    const { materialWords, visitWords } = splitWords(question, visits, catalog);
    const query = materialWords.join(' ');
    const recent = byActivity(visits)
      .slice(0, 4)
      .map((visit) => selectAction(visit, 'materials', query));

    if (visitWords.length === 0 && !question.reference) {
      return {
        text: '¿De qué visita? Escribe el cliente o el título (por ejemplo «materiales de la visita de Clínica Sur») o elige una reciente:',
        actions: recent,
      };
    }

    let candidates = visitWords.length > 0 ? matchVisits(visitWords, visits) : visits;
    if (question.reference === 'today') candidates = activeOn(candidates, context.now);
    if (question.reference === 'yesterday') {
      candidates = activeOn(candidates, new Date(context.now.getTime() - DAY_MS));
    }
    candidates = byActivity(candidates);
    if (question.reference === 'latest') candidates = candidates.slice(0, 1);

    const [first] = candidates;
    if (!first) {
      const parts = [
        visitWords.length > 0 ? `que coincidan con «${visitWords.join(' ')}»` : null,
        question.reference ? `con actividad ${REFERENCE_TEXT[question.reference]}` : null,
      ].filter(Boolean);
      return {
        text: `No encontré visitas ${parts.join(' y ')} en este teléfono. Elige una reciente:`,
        actions: recent,
      };
    }
    if (candidates.length === 1) return await materialsOfVisit(db, first, materialWords);

    const shown = candidates.slice(0, MAX_CHOICES);
    return {
      text: `Encontré ${candidates.length} visitas que coinciden. ¿Cuál quieres?${
        candidates.length > shown.length ? ` (muestro las ${shown.length} más recientes)` : ''
      }`,
      actions: shown.map((visit) => selectAction(visit, 'materials', query)),
    };
  } catch {
    return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  }
}

/** Respuesta al tocar una visita de la lista (materiales de esa visita). */
export async function answerVisitMaterialsChoice(
  db: Database,
  context: AssistantContext,
  visitId: string,
  query?: string,
): Promise<VisitMaterialsAnswer> {
  try {
    const visitQuery = buildVisitByIdQuery(visitId, visitScopeFor(context.user));
    const row = await db.getOptional<Row>(visitQuery.sql, visitQuery.parameters);
    if (!row) {
      return {
        text: 'Esa visita ya no está en este teléfono. Busca otra por cliente o título.',
        actions: [],
      };
    }
    return await materialsOfVisit(db, visitFromRow(row), tokenize(query ?? ''));
  } catch {
    return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  }
}

/** «¿En qué visitas se usó cable?»: una línea por visita, sin sumar entre visitas. */
export async function answerMaterialVisits(
  db: Database,
  context: AssistantContext,
  words: readonly string[],
): Promise<VisitMaterialsAnswer> {
  try {
    if (words.length === 0) {
      return {
        text: '¿De qué material? Por ejemplo: «¿en qué visitas se usó cable?».',
        actions: [
          suggestion('Materiales de la última visita', '¿Qué materiales usé en la última visita?'),
        ],
      };
    }
    const materials = matchMaterials(words, await loadCatalog(db));
    const [material] = materials;
    if (!material) {
      return {
        text: `No encontré «${words.join(' ')}» en el catálogo de materiales.`,
        actions: [],
      };
    }
    if (materials.length > 1) {
      return {
        text: `Encontré ${materials.length} materiales que coinciden. ¿Cuál?`,
        actions: materials.map((entry) =>
          suggestion(entry.name, `¿En qué visitas se usó ${entry.code || entry.name}?`),
        ),
      };
    }
    const usage = await getMaterialUsageByVisit(db, material.id, { limit: MAX_USAGE_VISITS });
    if (usage.visits.length === 0) {
      return {
        text: `«${material.name}» no se usó en las visitas guardadas en este teléfono. ${LOCAL_MESSAGES.deviceScope}`,
        actions: [],
      };
    }
    const lines = usage.visits.map((visit) => {
      const name = visit.clientName ? `${visit.clientName} — ${visit.title}` : visit.title;
      const date = formatShortDate(visit.date);
      const owner =
        visit.technicianId !== context.user.id
          ? ` · ${visit.technicianName ?? 'otro técnico'}`
          : '';
      return `${name}${date ? ` (${date})` : ''} · ${VISIT_STATUS_LABELS[visit.status]}${owner}: ${qty(visit.quantity, visit.unit)}`;
    });
    const more =
      usage.visitCount > usage.visits.length
        ? `\n…y ${usage.visitCount - usage.visits.length} visitas más (detalle en Inventario → ${material.name} → «Uso por visita»).`
        : '';
    return {
      text: `«${material.name}» se usó en ${plural(usage.visitCount, 'visita', 'visitas')} (total ${qty(usage.total, material.unit)}), de la más reciente a la más antigua:\n${bullet(lines)}${more}\n${LOCAL_MESSAGES.deviceScope}`,
      actions: [{ type: 'open_inventory' }],
    };
  } catch {
    return { text: LOCAL_MESSAGES.databaseError, actions: [] };
  }
}
