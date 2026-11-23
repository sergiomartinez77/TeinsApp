import { hasPhrase, normalizeText } from '../text';

/**
 * Periodos de tiempo escritos en español ("hoy", "esta semana", "del 1 al 15
 * de noviembre"…), en la hora LOCAL del teléfono. Fin incluido.
 */

export interface Period {
  readonly from: Date;
  readonly to: Date;
  /** Cómo se nombra en la respuesta ("esta semana", "del 1 al 15 de noviembre de 2026"). */
  readonly label: string;
}

export const MONTH_NAMES = [
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
] as const;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
const endOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const lastDayOfMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/** "22 de noviembre de 2026" */
export function formatDayLabel(date: Date): string {
  return `${date.getDate()} de ${MONTH_NAMES[date.getMonth()]} de ${date.getFullYear()}`;
}

function monthIndex(word: string): number {
  const index = MONTH_NAMES.findIndex((month) => month === word);
  if (index >= 0) return index;
  // "setiembre" y abreviaturas de tres letras ("nov").
  if (word === 'setiembre') return 8;
  return MONTH_NAMES.findIndex((month) => word.length === 3 && month.startsWith(word));
}

/** Lunes de la semana de `date` (la semana empieza el lunes). */
function mondayOf(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return addDays(startOfDay(date), -offset);
}

function monthPeriod(year: number, month: number, label: string, now: Date): Period {
  const from = new Date(year, month, 1);
  const lastDay = new Date(year, month, lastDayOfMonth(year, month));
  return { from, to: endOfDay(lastDay > now ? now : lastDay), label };
}

/**
 * "del 1 al 15 de noviembre [de 2026]", "entre el 3 y el 10 de octubre",
 * "del 28 de octubre al 4 de noviembre".
 */
function explicitRange(normalized: string, now: Date): Period | null {
  const match =
    /(?:del|entre el|entre|desde el|desde)\s+(\d{1,2})(?:\s+de\s+([a-z]+))?\s+(?:al|y el|y|hasta el|hasta)\s+(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de|del)\s+(\d{4}))?/.exec(
      normalized,
    );
  if (!match) return null;
  const [, fromDayText, fromMonthText, toDayText, toMonthText, yearText] = match;
  const toMonth = monthIndex(toMonthText ?? '');
  if (toMonth < 0) return null;
  const fromMonth = fromMonthText ? monthIndex(fromMonthText) : toMonth;
  if (fromMonth < 0) return null;
  let year = yearText ? Number(yearText) : now.getFullYear();
  // Sin año y con un mes que aún no llegó: se entiende el año pasado.
  if (!yearText && toMonth > now.getMonth()) year -= 1;
  const fromYear = fromMonth > toMonth ? year - 1 : year;
  const fromDay = Number(fromDayText);
  const toDay = Number(toDayText);
  if (fromDay < 1 || fromDay > lastDayOfMonth(fromYear, fromMonth)) return null;
  if (toDay < 1 || toDay > lastDayOfMonth(year, toMonth)) return null;
  const from = new Date(fromYear, fromMonth, fromDay);
  const to = endOfDay(new Date(year, toMonth, toDay));
  if (from > to) return null;
  return { from, to, label: `del ${formatDayLabel(from)} al ${formatDayLabel(to)}` };
}

/** Periodo mencionado en el texto, o `null` si no hay ninguno. */
export function parsePeriod(text: string, now: Date): Period | null {
  const normalized = normalizeText(text);

  const range = explicitRange(normalized, now);
  if (range) return range;

  if (hasPhrase(normalized, 'anteayer') || hasPhrase(normalized, 'antier')) {
    const day = addDays(now, -2);
    return { from: startOfDay(day), to: endOfDay(day), label: `anteayer (${formatDayLabel(day)})` };
  }
  if (hasPhrase(normalized, 'ayer')) {
    const day = addDays(now, -1);
    return { from: startOfDay(day), to: endOfDay(day), label: `ayer (${formatDayLabel(day)})` };
  }
  if (hasPhrase(normalized, 'hoy')) {
    return { from: startOfDay(now), to: endOfDay(now), label: `hoy (${formatDayLabel(now)})` };
  }

  const lastDays = /ultimos?\s+(\d{1,3})\s+dias?/.exec(normalized);
  if (lastDays) {
    const days = Math.max(1, Math.min(366, Number(lastDays[1])));
    return {
      from: startOfDay(addDays(now, -(days - 1))),
      to: endOfDay(now),
      label: `los últimos ${days} días`,
    };
  }

  if (hasPhrase(normalized, 'semana pasada') || hasPhrase(normalized, 'semana anterior')) {
    const monday = addDays(mondayOf(now), -7);
    return { from: monday, to: endOfDay(addDays(monday, 6)), label: 'la semana pasada' };
  }
  if (hasPhrase(normalized, 'semana')) {
    return { from: mondayOf(now), to: endOfDay(now), label: 'esta semana' };
  }

  if (hasPhrase(normalized, 'mes pasado') || hasPhrase(normalized, 'mes anterior')) {
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = (now.getMonth() + 11) % 12;
    return monthPeriod(year, month, `el mes pasado (${MONTH_NAMES[month]} de ${year})`, now);
  }
  if (hasPhrase(normalized, 'mes')) {
    return monthPeriod(now.getFullYear(), now.getMonth(), 'este mes', now);
  }

  if (hasPhrase(normalized, 'ano pasado')) {
    const year = now.getFullYear() - 1;
    return { from: new Date(year, 0, 1), to: endOfDay(new Date(year, 11, 31)), label: `${year}` };
  }
  if (hasPhrase(normalized, 'este ano') || hasPhrase(normalized, 'ano')) {
    return {
      from: new Date(now.getFullYear(), 0, 1),
      to: endOfDay(now),
      label: `este año (${now.getFullYear()})`,
    };
  }

  // "en noviembre", "de octubre de 2025"
  const named = /(?:^|\s)(?:en|de|durante)\s+([a-z]+)(?:\s+(?:de|del)\s+(\d{4}))?(?:\s|$)/.exec(
    normalized,
  );
  if (named) {
    const month = monthIndex(named[1] ?? '');
    if (month >= 0 && (named[1] ?? '').length > 3) {
      let year = named[2] ? Number(named[2]) : now.getFullYear();
      if (!named[2] && month > now.getMonth()) year -= 1;
      return monthPeriod(year, month, `${MONTH_NAMES[month]} de ${year}`, now);
    }
  }
  return null;
}

/** Periodo por defecto para el consumo cuando no se indica ninguno. */
export function currentMonth(now: Date): Period {
  return monthPeriod(now.getFullYear(), now.getMonth(), 'este mes', now);
}
