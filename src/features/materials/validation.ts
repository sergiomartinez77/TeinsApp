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

// ── Materiales personalizados (solo en la visita) ────────────────────────────

/** Límites del nombre y la unidad escritos por el técnico (iguales en el servidor). */
export const CUSTOM_MATERIAL_LIMITS = {
  nameMax: 120,
  unitMax: 20,
} as const;

/** Unidades que se ofrecen en el selector. */
export const CUSTOM_UNITS = [
  'unidad',
  'metro',
  'kg',
  'litro',
  'caja',
  'rollo',
  'par',
  'juego',
  'global',
] as const;

/** Valor del selector que permite escribir otra unidad. */
export const CUSTOM_UNIT_OTHER = 'otra';

export const CUSTOM_UNIT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'unidad', label: 'Unidad' },
  { value: 'metro', label: 'Metro' },
  { value: 'kg', label: 'Kilogramo (kg)' },
  { value: 'litro', label: 'Litro' },
  { value: 'caja', label: 'Caja' },
  { value: 'rollo', label: 'Rollo' },
  { value: 'par', label: 'Par' },
  { value: 'juego', label: 'Juego' },
  { value: 'global', label: 'Global' },
  { value: CUSTOM_UNIT_OTHER, label: 'Otra (escribirla)' },
];

export const CUSTOM_MATERIAL_MESSAGES = {
  nameRequired: 'Escribe el nombre del material.',
  nameTooLong: `El nombre no puede superar los ${CUSTOM_MATERIAL_LIMITS.nameMax} caracteres.`,
  unitRequired: 'Elige la unidad.',
  otherUnitRequired: 'Escribe la unidad.',
  unitTooLong: `La unidad no puede superar los ${CUSTOM_MATERIAL_LIMITS.unitMax} caracteres.`,
} as const;

/** Quita espacios al principio y al final y deja uno solo entre palabras. */
export function normalizeCustomText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Clave para detectar personalizados repetidos en la visita: mismo nombre y
 * misma unidad sin distinguir mayúsculas ni espacios.
 */
export function customMaterialKey(name: string, unit: string): string {
  const key = (value: string) => normalizeCustomText(value).toLocaleLowerCase('es');
  return `${key(name)}\u0000${key(unit)}`;
}

/** Error del nombre ya normalizado, o `null`. */
export function customNameError(name: string): string | null {
  if (!name) return CUSTOM_MATERIAL_MESSAGES.nameRequired;
  if (name.length > CUSTOM_MATERIAL_LIMITS.nameMax) return CUSTOM_MATERIAL_MESSAGES.nameTooLong;
  return null;
}

/** Error de la unidad ya normalizada, o `null`. */
export function customUnitError(unit: string): string | null {
  if (!unit) return CUSTOM_MATERIAL_MESSAGES.otherUnitRequired;
  if (unit.length > CUSTOM_MATERIAL_LIMITS.unitMax) return CUSTOM_MATERIAL_MESSAGES.unitTooLong;
  return null;
}

/** Formulario "Agregar material que no está en el catálogo". */
export const customMaterialSchema = z
  .object({
    name: z.string(),
    unit: z.string(),
    otherUnit: z.string(),
    quantity: quantitySchema,
    observations: observationsSchema,
  })
  .superRefine((values, ctx) => {
    const nameError = customNameError(normalizeCustomText(values.name));
    if (nameError) ctx.addIssue({ code: 'custom', path: ['name'], message: nameError });
    if (!values.unit) {
      ctx.addIssue({
        code: 'custom',
        path: ['unit'],
        message: CUSTOM_MATERIAL_MESSAGES.unitRequired,
      });
    } else if (values.unit === CUSTOM_UNIT_OTHER) {
      const unitError = customUnitError(normalizeCustomText(values.otherUnit));
      if (unitError) ctx.addIssue({ code: 'custom', path: ['otherUnit'], message: unitError });
    }
  })
  .transform((values) => ({
    name: normalizeCustomText(values.name),
    unit:
      values.unit === CUSTOM_UNIT_OTHER
        ? normalizeCustomText(values.otherUnit)
        : normalizeCustomText(values.unit),
    quantity: values.quantity,
    observations: values.observations,
  }));

/** Valores del formulario de material personalizado tal como los escribe el técnico. */
export type CustomMaterialFormValues = z.input<typeof customMaterialSchema>;
/** Material personalizado ya validado: nombre y unidad normalizados. */
export type CustomMaterialInput = z.output<typeof customMaterialSchema>;
