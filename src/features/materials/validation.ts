import { z } from 'zod';

import { countDecimals, parseNumberInput } from '@/utils/number.utils';

/** Límites de la cantidad: en el servidor es NUMERIC(12,3). */
export const QUANTITY_LIMITS = {
  maxDecimals: 3,
  max: 999_999_999,
} as const;

export const OBSERVATIONS_MAX_LENGTH = 500;

export const MATERIAL_MESSAGES = {
  quantityRequired: 'Ingresa la cantidad.',
  invalidNumber: 'Ingresa un número válido.',
  quantityPositive: 'La cantidad debe ser mayor que cero.',
  maxDecimals: 'Usa como máximo 3 decimales.',
  quantityTooLarge: 'La cantidad no puede superar 999 999 999.',
  observationsTooLong: `Las observaciones no pueden superar los ${OBSERVATIONS_MAX_LENGTH} caracteres.`,
} as const;

/** Error de una cantidad ya convertida a número, o `null` si es válida. */
export function quantityValueError(value: number): string | null {
  if (!Number.isFinite(value)) return MATERIAL_MESSAGES.invalidNumber;
  if (value <= 0) return MATERIAL_MESSAGES.quantityPositive;
  if (value > QUANTITY_LIMITS.max) return MATERIAL_MESSAGES.quantityTooLarge;
  if (countDecimals(value) > QUANTITY_LIMITS.maxDecimals) return MATERIAL_MESSAGES.maxDecimals;
  return null;
}

/** Error de la cantidad tal como la escribió el técnico, o `null` si es válida. */
export function quantityTextError(text: string): string | null {
  if (!text.trim()) return MATERIAL_MESSAGES.quantityRequired;
  const value = parseNumberInput(text, 'decimal');
  if (value === null) return MATERIAL_MESSAGES.invalidNumber;
  return quantityValueError(value);
}

/** Cantidad: texto con coma o punto decimal que se guarda como número. */
const quantitySchema = z
  .string()
  .superRefine((value, ctx) => {
    const message = quantityTextError(value);
    if (message) ctx.addIssue({ code: 'custom', message });
  })
  .transform((value) => parseNumberInput(value, 'decimal') ?? 0);

/** Observaciones opcionales: se recortan y, si quedan vacías, son `null`. */
const observationsSchema = z
  .string()
  .trim()
  .max(OBSERVATIONS_MAX_LENGTH, MATERIAL_MESSAGES.observationsTooLong)
  .transform((value) => (value.length > 0 ? value : null));

/** Validación de cantidad y observaciones (al agregar y al editar). */
export const materialEntrySchema = z.object({
  quantity: quantitySchema,
  observations: observationsSchema,
});

/** Valores tal como los escribe el técnico. */
export type MaterialEntryFormValues = z.input<typeof materialEntrySchema>;
/** Valores ya validados y normalizados. */
export type MaterialEntryInput = z.output<typeof materialEntrySchema>;
