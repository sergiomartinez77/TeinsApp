/**
 * Utilidades de fecha en español.
 *
 * Se formatea a mano (sin `Intl`) para que el resultado sea idéntico en
 * Android e iOS. Los datos se guardan en ISO 8601 UTC y se muestran en la
 * hora local del dispositivo.
 */

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const MONTHS_SHORT = MONTHS.map((month) => month.slice(0, 3));

const pad = (value: number) => String(value).padStart(2, '0');

/** Fecha válida a partir de texto ISO o Date; `null` si no se puede interpretar. */
export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Fecha y hora actuales en ISO 8601 UTC, el formato de todos los registros. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Saludo según la hora local: buenos días / buenas tardes / buenas noches. */
export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** "miércoles, 11 de noviembre de 2026" */
export function formatLongDate(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

/** "11 nov 2026" */
export function formatShortDate(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** "14:05" */
export function formatTime(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "11 nov 2026, 14:05" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  return `${formatShortDate(date)}, ${formatTime(date)}`;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "hace un momento", "hace 5 min", "hace 3 h", "ayer", "hace 4 días" o la fecha corta. */
export function formatRelative(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseDate(value);
  if (!date) return '';

  const elapsed = now.getTime() - date.getTime();
  if (elapsed < 0) return formatDateTime(date);
  if (elapsed < MINUTE) return 'hace un momento';
  if (elapsed < HOUR) return `hace ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `hace ${Math.floor(elapsed / HOUR)} h`;
  if (elapsed < 2 * DAY) return 'ayer';
  if (elapsed < 7 * DAY) return `hace ${Math.floor(elapsed / DAY)} días`;
  return formatShortDate(date);
}
