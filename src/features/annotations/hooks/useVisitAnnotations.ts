import { useQuery } from '@powersync/react';
import { useMemo } from 'react';

import { annotationFromRow, type VisitAnnotation } from '@/models/annotation.model';

import { ANNOTATION_BY_ID_SQL, ANNOTATIONS_BY_VISIT_SQL } from '../services/annotation.queries';

export interface VisitAnnotationsResult {
  /** Planos de la visita, del más antiguo al más nuevo. */
  annotations: VisitAnnotation[];
  isLoading: boolean;
  hasError: boolean;
}

/** Planos de la visita. Reactiva. */
export function useVisitAnnotations(visitId: string): VisitAnnotationsResult {
  const result = useQuery<Record<string, unknown>>(ANNOTATIONS_BY_VISIT_SQL, [visitId]);
  const annotations = useMemo(() => result.data.map(annotationFromRow), [result.data]);
  return { annotations, isLoading: result.isLoading, hasError: Boolean(result.error) };
}

export interface AnnotationResult {
  annotation: VisitAnnotation | null;
  isLoading: boolean;
  hasError: boolean;
}

/** Un plano por id (o `null` si no existe). Reactiva. */
export function useAnnotation(annotationId: string): AnnotationResult {
  const result = useQuery<Record<string, unknown>>(ANNOTATION_BY_ID_SQL, [annotationId]);
  const row = result.data[0];
  const annotation = useMemo(() => (row ? annotationFromRow(row) : null), [row]);
  return { annotation, isLoading: result.isLoading, hasError: Boolean(result.error) };
}
