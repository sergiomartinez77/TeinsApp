import { z } from 'zod';

import {
  allFields,
  type FormField,
  type FormFieldType,
  type FormTemplate,
  type FormValue,
  type FormValues,
} from '@/models/form.model';
import { parseNumberInput } from '@/utils/number.utils';

// Se reexporta para no romper a quien ya la importaba desde aquí.
export { parseNumberInput };

/**
 * Estado editable del formulario y su validación, construidos a partir de la plantilla.
 *
 * Mientras se edita, cada campo guarda lo que muestra el control:
 * - textos, números, fechas, horas y selección única → texto (`''` = vacío);
 * - sí/no → `true`, `false` o `null` (sin responder);
 * - selección múltiple → lista de opciones.
 * Al guardar se normaliza (números como número, vacíos fuera).
 */

export type DraftValue = string | boolean | null | string[];
export type FormDraft = Record<string, DraftValue>;

export const FORM_MESSAGES = {
  required: 'Este campo es obligatorio.',
  invalidNumber: 'Ingresa un número válido.',
  integerOnly: 'Ingresa un número entero, sin decimales.',
} as const;

const isNumeric = (type: FormFieldType) => type === 'number' || type === 'decimal';

/** Mensaje de error de un número no vacío, o `null` si es válido. */
function numberError(text: string, type: 'number' | 'decimal'): string | null {
  if (parseNumberInput(text, type) !== null) return null;
  if (type === 'number' && parseNumberInput(text, 'decimal') !== null) {
    return FORM_MESSAGES.integerOnly;
  }
  return FORM_MESSAGES.invalidNumber;
}

function fieldSchema(field: FormField): z.ZodType<DraftValue, DraftValue> {
  switch (field.type) {
    case 'boolean':
      return z
        .boolean()
        .nullable()
        .refine((value) => !field.required || value !== null, FORM_MESSAGES.required);
    case 'multiSelect':
      return z
        .array(z.string())
        .refine((value) => !field.required || value.length > 0, FORM_MESSAGES.required);
    default: {
      const { type } = field;
      return z.string().superRefine((value, ctx) => {
        const trimmed = value.trim();
        if (!trimmed) {
          if (field.required) ctx.addIssue({ code: 'custom', message: FORM_MESSAGES.required });
          return;
        }
        if (type === 'number' || type === 'decimal') {
          const message = numberError(trimmed, type);
          if (message) ctx.addIssue({ code: 'custom', message });
        }
      });
    }
  }
}

/** Esquema Zod del formulario, un campo por cada campo de la plantilla. */
export function buildFormSchema(template: FormTemplate): z.ZodType<FormDraft, FormDraft> {
  const shape: Record<string, z.ZodType<DraftValue, DraftValue>> = {};
  for (const field of allFields(template)) shape[field.id] = fieldSchema(field);
  return z.object(shape);
}

export function emptyDraftValue(field: Pick<FormField, 'type'>): DraftValue {
  if (field.type === 'boolean') return null;
  if (field.type === 'multiSelect') return [];
  return '';
}

function toDraftValue(field: FormField, saved: FormValue | undefined): DraftValue {
  if (saved === undefined) return emptyDraftValue(field);
  switch (field.type) {
    case 'boolean':
      return typeof saved === 'boolean' ? saved : null;
    case 'multiSelect':
      if (Array.isArray(saved)) return saved;
      return typeof saved === 'string' && saved ? [saved] : [];
    default:
      if (typeof saved === 'string') return saved;
      if (typeof saved === 'number') return String(saved);
      return '';
  }
}

/** Valores iniciales del formulario a partir de las respuestas guardadas. */
export function draftFromValues(template: FormTemplate, values: FormValues): FormDraft {
  const draft: FormDraft = {};
  for (const field of allFields(template)) draft[field.id] = toDraftValue(field, values[field.id]);
  return draft;
}

/**
 * Respuestas a guardar: números como número, textos recortados y sin claves
 * para los campos vacíos. Un número inválido no se guarda.
 */
export function draftToValues(template: FormTemplate, draft: FormDraft): FormValues {
  const values: FormValues = {};
  for (const field of allFields(template)) {
    const value = draft[field.id];
    if (field.type === 'boolean') {
      if (typeof value === 'boolean') values[field.id] = value;
    } else if (field.type === 'multiSelect') {
      if (Array.isArray(value) && value.length > 0) values[field.id] = [...value];
    } else if (typeof value === 'string') {
      if (isNumeric(field.type)) {
        const number = parseNumberInput(value, field.type === 'number' ? 'number' : 'decimal');
        if (number !== null) values[field.id] = number;
      } else if (value.trim()) {
        values[field.id] = value.trim();
      }
    }
  }
  return values;
}

/** Errores por campo (`{ idDelCampo: mensaje }`); vacío si todo es válido. */
export function validateDraft(template: FormTemplate, draft: FormDraft): Record<string, string> {
  const result = buildFormSchema(template).safeParse(draft);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

/** Ids de las secciones que contienen alguno de los campos con error, en orden. */
export function sectionsWithErrors(
  template: Pick<FormTemplate, 'sections'>,
  fieldIds: Iterable<string>,
): string[] {
  const withErrors = new Set(fieldIds);
  return template.sections
    .filter((section) => section.fields.some((field) => withErrors.has(field.id)))
    .map((section) => section.id);
}
