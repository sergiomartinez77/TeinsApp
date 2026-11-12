import { formatLongDate } from '@/utils/date.utils';

/**
 * Formato de los campos de fecha y hora.
 * Se guardan como texto local, sin zona horaria: fecha `YYYY-MM-DD`, hora `HH:mm`.
 */

const pad = (value: number) => String(value).padStart(2, '0');

const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_VALUE = /^(\d{2}):(\d{2})$/;

export function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toTimeValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Fecha local a partir de `YYYY-MM-DD`; `null` si no es válida. */
export function parseDateValue(value: string): Date | null {
  const match = DATE_VALUE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** Hora de hoy a partir de `HH:mm`; `null` si no es válida. */
export function parseTimeValue(value: string, base: Date = new Date()): Date | null {
  const match = TIME_VALUE.exec(value);
  if (!match) return null;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  if (hours > 23 || minutes > 59) return null;
  const date = new Date(base);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/** "miércoles, 11 de noviembre de 2026" o el texto guardado si no se reconoce. */
export function formatDateValue(value: string): string {
  const date = parseDateValue(value);
  return date ? formatLongDate(date) : value;
}

/** "14:05" o el texto guardado si no se reconoce. */
export function formatTimeValue(value: string): string {
  const date = parseTimeValue(value);
  return date ? toTimeValue(date) : value;
}
