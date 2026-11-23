/**
 * Textos de estado de cada sección en el resumen de la visita.
 * Funciones puras: reciben los datos ya cargados y devuelven el texto a mostrar.
 */
import { elementCountLabel, planCountLabel } from '@/models/annotation.model';
import type { MaterialsSummary } from '@/models/material.model';
import { photoCountLabel } from '@/models/photo.model';

import { formsSummaryText } from '@/features/forms/services/visit-forms';

import type { VisitSection } from '../components/SectionGrid';

/** Secciones que aparecen en el resumen (el resumen no se lista a sí mismo). */
export type SummarySection = Exclude<VisitSection, 'summary'>;

/** Línea de estado de cada sección del resumen. */
export type SectionStatuses = Readonly<Record<SummarySection, string>>;

export const SUMMARY_MESSAGES = {
  unavailable: 'No disponible',
  loading: 'Cargando...',
  formNotStarted: 'Sin iniciar',
  formInProgress: 'En curso',
  formCompleted: 'Completado',
  noMaterials: 'Sin materiales',
  noPhotos: 'Sin fotografías',
  noAnnotations: 'Sin planos',
} as const;

const SEPARATOR = ' · ';

/** Estado de una consulta de sección. */
export interface SectionQueryState {
  isLoading: boolean;
  hasError: boolean;
}

/**
 * Texto de una sección según el estado de su consulta: si falló, "No disponible";
 * mientras carga, "Cargando..."; si no, el texto que devuelve `build`.
 */
export function sectionStatusText(state: SectionQueryState, build: () => string): string {
  if (state.hasError) return SUMMARY_MESSAGES.unavailable;
  if (state.isLoading) return SUMMARY_MESSAGES.loading;
  return build();
}

/**
 * Formularios técnicos (varios por visita): "Sin iniciar" o
 * "N formularios · M completados".
 */
export function formsStatusText(forms: readonly { readonly isComplete: boolean }[]): string {
  return formsSummaryText(forms);
}

/**
 * Materiales: "Sin materiales" o "N materiales · 120 metro · 14 unidad"; si hay
 * personalizados, "N materiales · 1 personalizado · 120 metro".
 */
export function materialsStatusText(
  summary: Omit<MaterialsSummary, 'customCount' | 'customLabel'> &
    Partial<Pick<MaterialsSummary, 'customLabel'>>,
): string {
  if (summary.count === 0) return SUMMARY_MESSAGES.noMaterials;
  return [summary.countLabel, summary.customLabel, summary.totalsLabel]
    .filter((part): part is string => Boolean(part))
    .join(SEPARATOR);
}

/** Fotografías: "Sin fotografías", "N fotografías" y, si hay, " · M por subir". */
export function photosStatusText(total: number, pending: number): string {
  if (total <= 0) return SUMMARY_MESSAGES.noPhotos;
  const label = photoCountLabel(total);
  return pending > 0 ? `${label}${SEPARATOR}${pending} por subir` : label;
}

/** Planos: "Sin planos" o "N planos · M elementos". */
export function annotationsStatusText(planCount: number, elementCount: number): string {
  if (planCount <= 0) return SUMMARY_MESSAGES.noAnnotations;
  return `${planCountLabel(planCount)}${SEPARATOR}${elementCountLabel(Math.max(0, elementCount))}`;
}
