/**
 * Utilidades para leer y mostrar números escritos por el técnico.
 * En pantalla se usa coma decimal; al escribir se acepta coma o punto.
 */

const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

/**
 * Número escrito por el técnico. Acepta coma o punto decimal.
 * Devuelve `null` si está vacío o no es válido para el tipo de campo.
 */
export function parseNumberInput(text: string, type: 'number' | 'decimal'): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (type === 'number') return INTEGER.test(trimmed) ? Number(trimmed) : null;
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** Decimales que tiene el número, sin contar ceros finales. */
export function countDecimals(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = String(Math.abs(value));
  const exponent = /e-(\d+)$/.exec(text);
  if (exponent?.[1]) {
    const mantissa = text.slice(0, text.indexOf('e'));
    const mantissaDecimals = mantissa.split('.')[1]?.length ?? 0;
    return mantissaDecimals + Number(exponent[1]);
  }
  return text.split('.')[1]?.length ?? 0;
}

/**
 * Cantidad para mostrar: coma decimal, sin ceros finales y hasta 3 decimales.
 * Ej.: 12.5 → "12,5"; 3 → "3"; 0.125 → "0,125".
 */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const normalized = fixed === '-0' ? '0' : fixed;
  return normalized.replace('.', ',');
}
