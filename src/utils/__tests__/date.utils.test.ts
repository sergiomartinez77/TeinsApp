import {
  formatDateTime,
  formatLongDate,
  formatRelative,
  formatShortDate,
  formatTime,
  greeting,
  nowIso,
  parseDate,
} from '../date.utils';

/** Fecha en hora local, para que los tests no dependan de la zona horaria. */
const local = (hour: number, minute = 0) => new Date(2026, 10, 11, hour, minute);

describe('utilidades de fecha', () => {
  it('saluda según la hora local', () => {
    expect(greeting(local(5))).toBe('Buenos días');
    expect(greeting(local(11, 59))).toBe('Buenos días');
    expect(greeting(local(12))).toBe('Buenas tardes');
    expect(greeting(local(18, 59))).toBe('Buenas tardes');
    expect(greeting(local(19))).toBe('Buenas noches');
    expect(greeting(local(3))).toBe('Buenas noches');
  });

  it('formatea fechas en español', () => {
    const date = local(14, 5);
    expect(formatLongDate(date)).toBe('miércoles, 11 de noviembre de 2026');
    expect(formatShortDate(date)).toBe('11 nov 2026');
    expect(formatTime(date)).toBe('14:05');
    expect(formatDateTime(date)).toBe('11 nov 2026, 14:05');
  });

  it('acepta texto ISO y devuelve vacío ante valores inválidos', () => {
    expect(formatShortDate(local(9).toISOString())).toBe('11 nov 2026');
    expect(formatLongDate(null)).toBe('');
    expect(formatDateTime('no es fecha')).toBe('');
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('2026-13-45')).toBeNull();
  });

  it('nowIso devuelve ISO 8601 en UTC', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('describe el tiempo transcurrido', () => {
    const now = local(12);
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;

    expect(formatRelative(ago(20_000), now)).toBe('hace un momento');
    expect(formatRelative(ago(5 * minute), now)).toBe('hace 5 min');
    expect(formatRelative(ago(3 * hour), now)).toBe('hace 3 h');
    expect(formatRelative(ago(30 * hour), now)).toBe('ayer');
    expect(formatRelative(ago(4 * day), now)).toBe('hace 4 días');
    expect(formatRelative(ago(10 * day), now)).toBe('1 nov 2026');
    expect(formatRelative('', now)).toBe('');
  });

  it('una fecha futura se muestra completa en lugar de un tiempo negativo', () => {
    const now = local(12);
    expect(formatRelative(local(13, 30), now)).toBe('11 nov 2026, 13:30');
  });
});
