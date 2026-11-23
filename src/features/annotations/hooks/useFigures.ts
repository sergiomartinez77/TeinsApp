import { useQuery } from '@powersync/react';
import { useMemo } from 'react';

import { figureFromRow, type AnnotationFigure } from '@/models/annotation.model';

import { FIGURES_BY_TECHNICIAN_SQL } from '../services/annotation.queries';

export interface FiguresResult {
  figures: AnnotationFigure[];
  isLoading: boolean;
  hasError: boolean;
}

/** Biblioteca de figuras del técnico (la misma en todas sus visitas). Reactiva. */
export function useFigures(technicianId: string): FiguresResult {
  const result = useQuery<Record<string, unknown>>(FIGURES_BY_TECHNICIAN_SQL, [technicianId]);
  const figures = useMemo(
    () => result.data.map(figureFromRow).filter((figure) => figure.elements.length > 0),
    [result.data],
  );
  return { figures, isLoading: result.isLoading, hasError: Boolean(result.error) };
}
