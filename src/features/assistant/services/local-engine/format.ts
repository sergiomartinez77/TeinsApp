import { VISIT_STATUS_LABELS, type Visit } from '@/models/visit.model';
import { formatShortDate } from '@/utils/date.utils';
import { formatQuantity } from '@/utils/number.utils';

import type { AssistantAction } from '../engine';

/**
 * Textos y formatos comunes de las respuestas del asistente básico (los usan
 * handlers.ts y visit-materials.ts).
 */

export const LOCAL_MESSAGES = {
  databaseError:
    'No pude leer los datos guardados en el teléfono. Intenta nuevamente en un momento.',
  syncNote: 'Datos de la última sincronización con el servidor.',
  deviceScope: 'Solo cuenta las visitas guardadas en este teléfono.',
  notUnderstood:
    'No entendí tu pregunta. Puedo consultar existencias, decirte qué comprar, el consumo de materiales, tus visitas, los materiales de una visita, generar el PDF de una visita o explicarte cómo usar la app.',
} as const;

export type Row = Record<string, unknown>;

export const qty = (value: number, unit: string) => `${formatQuantity(value)} ${unit}`.trim();
export const bullet = (lines: readonly string[]) => lines.map((line) => `• ${line}`).join('\n');
export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** "Cliente — Título (12 nov 2026)" o "Título (12 nov 2026)". */
export function visitLabel(visit: Visit): string {
  const date = formatShortDate(visit.completedAt ?? visit.startedAt ?? visit.createdAt);
  const name = visit.clientName ? `${visit.clientName} — ${visit.title}` : visit.title;
  return date ? `${name} (${date})` : name;
}

/** Línea de una visita en una lista; en las de otros técnicos, quién la tiene. */
export function visitLine(visit: Visit, userId?: string): string {
  const owner =
    userId !== undefined && visit.technicianId !== userId
      ? ` · ${visit.technicianName ?? 'otro técnico'}`
      : '';
  return `${visitLabel(visit)} · ${VISIT_STATUS_LABELS[visit.status]}${owner}`;
}

/** Chip para elegir una visita de la lista (PDF o materiales). */
export const selectAction = (
  visit: Visit,
  purpose: 'pdf' | 'materials' = 'pdf',
  query?: string,
): AssistantAction => ({
  type: 'select_visit',
  visitId: visit.id,
  label: visitLabel(visit),
  ...(purpose === 'materials' ? { purpose, ...(query ? { query } : {}) } : {}),
});
