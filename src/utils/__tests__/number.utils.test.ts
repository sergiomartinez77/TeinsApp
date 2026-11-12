import { countDecimals, formatQuantity, parseNumberInput } from '../number.utils';
import { escapeLike } from '../sql.utils';

describe('formatQuantity', () => {
  it('usa coma decimal y quita los ceros finales', () => {
    expect(formatQuantity(12.5)).toBe('12,5');
    expect(formatQuantity(3)).toBe('3');
    expect(formatQuantity(0.125)).toBe('0,125');
    expect(formatQuantity(10.1)).toBe('10,1');
    expect(formatQuantity(100)).toBe('100');
  });

  it('muestra como máximo 3 decimales', () => {
    expect(formatQuantity(1.23456)).toBe('1,235');
    expect(formatQuantity(0.1 + 0.2)).toBe('0,3');
  });

  it('no muestra "-0" ni valores no finitos', () => {
    expect(formatQuantity(-0.0001)).toBe('0');
    expect(formatQuantity(Number.NaN)).toBe('0');
  });
});

describe('parseNumberInput', () => {
  it('acepta coma o punto decimal', () => {
    expect(parseNumberInput('220,5', 'decimal')).toBe(220.5);
    expect(parseNumberInput(' 0.75 ', 'decimal')).toBe(0.75);
    expect(parseNumberInput(',5', 'decimal')).toBe(0.5);
  });

  it('rechaza textos que no son números', () => {
    expect(parseNumberInput('', 'decimal')).toBeNull();
    expect(parseNumberInput('abc', 'decimal')).toBeNull();
    expect(parseNumberInput('1.2.3', 'decimal')).toBeNull();
    expect(parseNumberInput('1,5', 'number')).toBeNull();
    expect(parseNumberInput('7', 'number')).toBe(7);
  });
});

describe('countDecimals', () => {
  it('cuenta los decimales sin ceros finales', () => {
    expect(countDecimals(3)).toBe(0);
    expect(countDecimals(1.5)).toBe(1);
    expect(countDecimals(1.234)).toBe(3);
    expect(countDecimals(1.2345)).toBe(4);
    expect(countDecimals(1e-7)).toBe(7);
  });
});

describe('escapeLike', () => {
  it('escapa los comodines de LIKE', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});
