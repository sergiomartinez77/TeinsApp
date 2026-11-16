import { useQuery } from '@powersync/react';
import { useMemo } from 'react';

import { annotationFromRow, type VisitAnnotation } from '@/models/annotation.model';

import { ANNOTATION_BY_VISIT_SQL } from '../services/annotation.queries';

export interface VisitAnnotationResult {
  annotation: VisitAnnotation | null;
  isLoading: boolean;
  hasError: boolean;
}

/** Anotación de la visita (o `null` si aún no se ha dibujado nada). Reactiva. */
export function useVisitAnnotation(visitId: string): VisitAnnotationResult {
  const result = useQuery<Record<string, unknown>>(ANNOTATION_BY_VISIT_SQL, [visitId]);
  const row = result.data[0];
  const annotation = useMemo(() => (row ? annotationFromRow(row) : null), [row]);

  return { annotation, isLoading: result.isLoading, hasError: Boolean(result.error) };
}
