import {
  contentWords,
  editDistance,
  hasAnyWord,
  hasPhrase,
  normalizeText,
  singularForms,
  tokenize,
  wordsMatch,
} from '../services/text';
import { currentMonth, formatDayLabel, parsePeriod } from '../services/local-engine/periods';

describe('normalización', () => {
  it('quita tildes, mayúsculas y signos', () => {
    expect(normalizeText('¿Cuánto CABLE me queda?')).toBe('cuanto cable me queda');
    expect(normalizeText('  Niño — Ñandú!! ')).toBe('nino nandu');
    expect(tokenize('')).toEqual([]);
    expect(tokenize('CAB-01, ok')).toEqual(['cab', '01', 'ok']);
  });

  it('compara palabras en singular y con errores de tecleo', () => {
    expect(singularForms('conectores')).toEqual(['conectores', 'conectore', 'conector']);
    expect(wordsMatch('cables', 'cable')).toBe(true);
    expect(wordsMatch('conectores', 'conector')).toBe(true);
    expect(wordsMatch('inventaro', 'inventario')).toBe(true);
    expect(wordsMatch('pendietes', 'pendientes')).toBe(true);
    expect(wordsMatch('hoy', 'hay')).toBe(false);
    expect(wordsMatch('cable', 'breaker')).toBe(false);
    expect(editDistance('abc', 'abcdef', 2)).toBe(3);
    expect(editDistance('kitten', 'sitting', 5)).toBe(3);
    expect(editDistance('abcdef', 'uvwxyz', 1)).toBe(2);
  });

  it('frases y palabras con contenido', () => {
    expect(hasPhrase('visitas en curso hoy', 'En curso')).toBe(true);
    expect(hasPhrase('recurso', 'curso')).toBe(false);
    expect(hasAnyWord(['visitaz'], ['visitas'])).toBe(true);
    expect(contentWords(['cuanto', 'cable', 'me', 'queda'], ['cuanto', 'queda'])).toEqual([
      'cable',
    ]);
  });
});

describe('periodos', () => {
  // Domingo 22 de noviembre de 2026, 15:00 (hora local).
  const now = new Date(2026, 10, 22, 15, 0, 0);
  const range = (text: string) => {
    const period = parsePeriod(text, now);
    return period
      ? [period.from.toLocaleDateString('sv'), period.to.toLocaleDateString('sv'), period.label]
      : null;
  };

  it('días y semanas', () => {
    expect(range('consumo de hoy')).toEqual([
      '2026-11-22',
      '2026-11-22',
      'hoy (22 de noviembre de 2026)',
    ]);
    expect(range('ayer')).toEqual(['2026-11-21', '2026-11-21', 'ayer (21 de noviembre de 2026)']);
    expect(range('anteayer')?.[0]).toBe('2026-11-20');
    expect(range('esta semana')).toEqual(['2026-11-16', '2026-11-22', 'esta semana']);
    expect(range('la semana pasada')).toEqual(['2026-11-09', '2026-11-15', 'la semana pasada']);
    expect(range('los últimos 7 días')).toEqual(['2026-11-16', '2026-11-22', 'los últimos 7 días']);
  });

  it('meses y años', () => {
    expect(range('este mes')).toEqual(['2026-11-01', '2026-11-22', 'este mes']);
    expect(range('el mes pasado')?.slice(0, 2)).toEqual(['2026-10-01', '2026-10-31']);
    expect(range('en octubre')?.slice(0, 2)).toEqual(['2026-10-01', '2026-10-31']);
    expect(range('en diciembre')?.slice(0, 2)).toEqual(['2025-12-01', '2025-12-31']);
    expect(range('de marzo de 2025')?.slice(0, 2)).toEqual(['2025-03-01', '2025-03-31']);
    expect(range('este año')?.slice(0, 2)).toEqual(['2026-01-01', '2026-11-22']);
    expect(range('el año pasado')?.slice(0, 2)).toEqual(['2025-01-01', '2025-12-31']);
    const january = parsePeriod('el mes pasado', new Date(2026, 0, 10));
    expect(january?.label).toBe('el mes pasado (diciembre de 2025)');
  });

  it('rangos explícitos', () => {
    expect(range('del 1 al 15 de noviembre')).toEqual([
      '2026-11-01',
      '2026-11-15',
      'del 1 de noviembre de 2026 al 15 de noviembre de 2026',
    ]);
    expect(range('entre el 3 y el 10 de octubre de 2026')?.slice(0, 2)).toEqual([
      '2026-10-03',
      '2026-10-10',
    ]);
    expect(range('del 28 de octubre al 4 de noviembre')?.slice(0, 2)).toEqual([
      '2026-10-28',
      '2026-11-04',
    ]);
    expect(range('del 20 de diciembre al 5 de enero')?.slice(0, 2)).toEqual([
      '2025-12-20',
      '2026-01-05',
    ]);
    // Un rango imposible se entiende como el mes nombrado.
    expect(range('del 1 al 40 de noviembre')?.[2]).toBe('noviembre de 2026');
    expect(range('del 10 al 2 de noviembre')?.[2]).toBe('noviembre de 2026');
    expect(range('del 1 al 5 de nada')).toBeNull();
    expect(range('cable utp')).toBeNull();
  });

  it('mes actual y etiquetas', () => {
    expect(currentMonth(now).label).toBe('este mes');
    expect(formatDayLabel(now)).toBe('22 de noviembre de 2026');
  });
});
