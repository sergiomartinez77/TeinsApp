import { scopedLogger } from '@/utils/logger';

import { parseRecordSyncStatus, type RecordSyncStatus } from './visit.model';

const log = scopedLogger('forms');

// ── Tipos de campo ───────────────────────────────────────────────────────────

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'decimal',
  'boolean',
  'date',
  'time',
  'select',
  'multiSelect',
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export function isFormFieldType(value: unknown): value is FormFieldType {
  return FORM_FIELD_TYPES.some((type) => type === value);
}

/**
 * Clave reservada dentro del JSON de respuestas: id de la plantilla de respaldo
 * (asset) con la que se llenó el formulario. Nunca se muestra ni se valida.
 */
export const TEMPLATE_KEY = '__template_key';

// ── Entidades ────────────────────────────────────────────────────────────────

export interface FormField {
  readonly id: string;
  readonly type: FormFieldType;
  readonly label: string;
  readonly required: boolean;
  readonly hint: string | null;
  /** Opciones de `select` y `multiSelect`. */
  readonly options: readonly string[];
  /** Unidad de medida de `number` y `decimal` ("V", "A", "%"). */
  readonly unit: string | null;
}

export interface FormSection {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly fields: readonly FormField[];
}

/**
 * Origen de la plantilla:
 * - `database`: sincronizada desde el servidor (id UUID).
 * - `asset`: respaldo incluido en la app (id de texto); solo vive en memoria.
 */
export type TemplateSource = 'database' | 'asset';

export interface FormTemplate {
  readonly id: string;
  readonly name: string;
  readonly visitType: string;
  readonly version: number;
  readonly isActive: boolean;
  readonly sections: readonly FormSection[];
  readonly source: TemplateSource;
}

/** Valor guardado de un campo. */
export type FormValue = string | number | boolean | string[];

/** Respuestas guardadas: `{ idDelCampo: valor }`. Los campos vacíos no tienen clave. */
export type FormValues = Record<string, FormValue>;

export interface FormResponse {
  readonly id: string;
  readonly visitId: string;
  /** Plantilla de la base; `null` si se llenó con una plantilla de respaldo. */
  readonly templateId: string | null;
  /** Id de la plantilla de respaldo (clave reservada del JSON), si la hay. */
  readonly templateKey: string | null;
  readonly templateVersion: number;
  readonly values: FormValues;
  readonly syncStatus: RecordSyncStatus;
  readonly isComplete: boolean;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly completedAt: string | null;
}

// ── Parseo seguro ────────────────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const integer = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

/**
 * Ids de campo admitidos: letras, números, `_` y `-`. Un punto o corchete
 * se confundiría con una ruta anidada al manejar el estado del formulario.
 */
const FIELD_ID = /^[\w-]+$/;

function parseField(raw: unknown, templateId: string): FormField | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const label = text(raw.label);
  if (!id || !label || !FIELD_ID.test(id) || id === TEMPLATE_KEY) {
    log.warn('Campo de formulario inválido; se omite', { templateId, fieldId: raw.id });
    return null;
  }

  let type: FormFieldType = 'text';
  if (isFormFieldType(raw.type)) {
    type = raw.type;
  } else {
    log.warn('Tipo de campo desconocido; se mostrará como texto', {
      templateId,
      fieldId: id,
      type: raw.type,
    });
  }

  const options = Array.isArray(raw.options)
    ? [...new Set(raw.options.map(text).filter((option): option is string => option !== null))]
    : [];

  return {
    id,
    type,
    label,
    required: raw.required === true,
    hint: text(raw.hint),
    options,
    unit: text(raw.unit),
  };
}

/** Secciones válidas ordenadas por `order`; `null` si no queda ninguna con campos. */
export function parseSections(raw: unknown, templateId: string): FormSection[] | null {
  if (!Array.isArray(raw)) return null;

  const seen = new Set<string>();
  const sections: FormSection[] = [];

  raw.forEach((item: unknown, index) => {
    if (!isRecord(item) || !Array.isArray(item.fields)) return;
    const fields: FormField[] = [];
    for (const rawField of item.fields as unknown[]) {
      const field = parseField(rawField, templateId);
      if (!field) continue;
      if (seen.has(field.id)) {
        log.warn('Campo repetido en la plantilla; se omite', { templateId, fieldId: field.id });
        continue;
      }
      seen.add(field.id);
      fields.push(field);
    }
    if (fields.length === 0) return;
    sections.push({
      id: text(item.id) ?? `seccion_${index}`,
      title: text(item.title) ?? `Sección ${index + 1}`,
      order: integer(item.order, index),
      fields,
    });
  });

  if (sections.length === 0) return null;
  return sections.sort((a, b) => a.order - b.order);
}

/** Plantilla de respaldo del asset. Devuelve `null` (con aviso) si no es válida. */
export function templateFromAsset(raw: unknown): FormTemplate | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const sections = id ? parseSections(raw.sections, id) : null;
  if (!id || !sections) {
    log.warn('Plantilla de respaldo inválida; se descarta', { templateId: raw.id });
    return null;
  }
  return {
    id,
    name: text(raw.name) ?? id,
    visitType: text(raw.visit_type) ?? 'general',
    version: integer(raw.version, 1),
    isActive: true,
    sections,
    source: 'asset',
  };
}

/** Todas las plantillas válidas de un asset (lista JSON). */
export function templatesFromAsset(raw: unknown): FormTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: unknown) => templateFromAsset(item))
    .filter((template): template is FormTemplate => template !== null);
}

/**
 * Plantilla a partir de una fila de `form_templates`.
 * Un `sections_json` vacío o mal formado descarta la plantilla (con aviso).
 */
export function templateFromRow(row: UnknownRecord): FormTemplate | null {
  const id = text(row.id);
  if (!id) return null;

  let raw: unknown = null;
  if (typeof row.sections_json === 'string') {
    try {
      raw = JSON.parse(row.sections_json);
    } catch {
      raw = null;
    }
  }
  // Se admite tanto la lista de secciones como un objeto `{ sections: [...] }`.
  const sections = parseSections(isRecord(raw) ? raw.sections : raw, id);
  if (!sections) {
    log.warn('Plantilla con secciones inválidas; se descarta', { templateId: id });
    return null;
  }

  return {
    id,
    name: text(row.name) ?? 'Formulario',
    visitType: text(row.visit_type) ?? 'general',
    version: integer(row.version, 1),
    isActive: integer(row.is_active, 0) === 1,
    sections,
    source: 'database',
  };
}

export function countFields(template: Pick<FormTemplate, 'sections'>): number {
  return template.sections.reduce((total, section) => total + section.fields.length, 0);
}

/** Campos de la plantilla en orden de sección. */
export function allFields(template: Pick<FormTemplate, 'sections'>): FormField[] {
  return template.sections.flatMap((section) => section.fields);
}

// ── Respuestas ───────────────────────────────────────────────────────────────

function isFormValue(value: unknown): value is FormValue {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Respuestas del JSON guardado, separando la clave reservada de la plantilla. */
export function parseResponsesJson(raw: unknown): {
  values: FormValues;
  templateKey: string | null;
} {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!isRecord(parsed)) return { values: {}, templateKey: null };

  const values: FormValues = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === TEMPLATE_KEY) continue;
    if (isFormValue(value)) values[key] = value;
  }
  return { values, templateKey: text(parsed[TEMPLATE_KEY]) };
}

/** Convierte una fila de `form_responses` en una respuesta. */
export function responseFromRow(row: UnknownRecord): FormResponse {
  const { values, templateKey } = parseResponsesJson(row.responses);
  return {
    id: String(row.id),
    visitId: text(row.visit_id) ?? '',
    templateId: text(row.template_id),
    templateKey,
    templateVersion: integer(row.template_version, 1),
    values,
    syncStatus: parseRecordSyncStatus(row.sync_status),
    isComplete: integer(row.is_complete, 0) === 1,
    createdAt: text(row.created_at) ?? '',
    updatedAt: text(row.updated_at),
    completedAt: text(row.completed_at),
  };
}
