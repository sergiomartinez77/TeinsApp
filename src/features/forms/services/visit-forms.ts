import {
  allFields,
  type FormResponse,
  type FormTemplate,
  type FormValue,
  type FormValues,
} from '@/models/form.model';

import {
  resolveTemplateForResponse,
  sortTemplatesForSelector,
  type TemplateCatalog,
  type TemplateOption,
} from './template.service';

/**
 * Formularios de una visita (varios por visita, como máximo uno por
 * plantilla). Lógica pura: lista, progreso, plantillas que se pueden agregar
 * y texto del resumen.
 */

export const VISIT_FORMS_MESSAGES = {
  inProgress: 'En curso',
  completed: 'Completado',
  notStarted: 'Sin iniciar',
  unknownTemplate: 'Formulario sin plantilla',
  noRequired: 'Sin campos obligatorios',
} as const;

export interface RequiredProgress {
  /** Campos obligatorios con respuesta. */
  filled: number;
  /** Campos obligatorios de la plantilla. */
  total: number;
}

/** Formulario de la visita, listo para mostrar. */
export interface VisitFormItem {
  readonly response: FormResponse;
  /** Plantilla con la que se llenó; `null` si ya no se conoce. */
  readonly template: FormTemplate | null;
  readonly name: string;
  readonly isComplete: boolean;
  readonly progress: RequiredProgress;
}

/** El campo tiene respuesta (un sí/no respondido cuenta, aunque sea "No"). */
export function hasAnswer(value: FormValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Cuántos campos obligatorios de la plantilla tienen respuesta. */
export function requiredProgress(
  template: Pick<FormTemplate, 'sections'> | null,
  values: FormValues,
): RequiredProgress {
  if (!template) return { filled: 0, total: 0 };
  const required = allFields(template).filter((field) => field.required);
  return {
    filled: required.filter((field) => hasAnswer(values[field.id])).length,
    total: required.length,
  };
}

/** "3 de 8 campos obligatorios", "1 de 1 campo obligatorio" o "Sin campos obligatorios". */
export function progressLabel(progress: RequiredProgress): string {
  if (progress.total === 0) return VISIT_FORMS_MESSAGES.noRequired;
  const noun = progress.total === 1 ? 'campo obligatorio' : 'campos obligatorios';
  return `${progress.filled} de ${progress.total} ${noun}`;
}

/** "En curso" o "Completado". */
export function formStateLabel(item: Pick<VisitFormItem, 'isComplete'>): string {
  return item.isComplete ? VISIT_FORMS_MESSAGES.completed : VISIT_FORMS_MESSAGES.inProgress;
}

/**
 * Formularios de la visita en el orden en que se empezaron, con su plantilla
 * resuelta como siempre (por id de la base, por clave del asset o, en
 * respuestas antiguas sin plantilla conocida, la del tipo de visita).
 */
export function buildVisitForms(
  responses: readonly FormResponse[],
  catalog: TemplateCatalog,
  visitType: string,
): VisitFormItem[] {
  return responses.map((response) => {
    const template = resolveTemplateForResponse(catalog, response, visitType);
    return {
      response,
      template,
      name: template?.name ?? VISIT_FORMS_MESSAGES.unknownTemplate,
      isComplete: response.isComplete,
      progress: requiredProgress(template, response.values),
    };
  });
}

/**
 * Plantillas que todavía se pueden agregar a la visita (las que no tienen ya
 * un formulario), con las del tipo de la visita primero, como el selector.
 */
export function addableTemplates(
  catalog: TemplateCatalog,
  forms: readonly Pick<VisitFormItem, 'response' | 'template'>[],
  visitType: string,
): TemplateOption[] {
  const used = new Set<string>();
  for (const form of forms) {
    if (form.template) used.add(form.template.id);
    for (const key of [form.response.templateRef, form.response.templateId]) {
      if (key) used.add(key);
    }
  }
  return sortTemplatesForSelector(
    catalog.available.filter((template) => !used.has(template.id)),
    visitType,
  );
}

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/** Resumen de la visita: "Sin iniciar" o "N formularios · M completados". */
export function formsSummaryText(forms: readonly { readonly isComplete: boolean }[]): string {
  if (forms.length === 0) return VISIT_FORMS_MESSAGES.notStarted;
  const completed = forms.filter((form) => form.isComplete).length;
  return `${plural(forms.length, 'formulario', 'formularios')} · ${plural(
    completed,
    'completado',
    'completados',
  )}`;
}
