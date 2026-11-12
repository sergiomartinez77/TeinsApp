import { useQuery } from '@powersync/react';
import { useCallback, useMemo } from 'react';

import {
  summarizeMaterials,
  visitMaterialFromRow,
  type MaterialsSummary,
  type VisitMaterial,
} from '@/models/material.model';

import { VISIT_MATERIALS_SQL } from '../services/material.queries';

export interface VisitMaterialsResult {
  materials: VisitMaterial[];
  summary: MaterialsSummary;
  /** Materiales del catálogo que ya están en la visita. */
  materialIds: ReadonlySet<string>;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => void;
}

/** Materiales de la visita, reactivos: la lista se actualiza sola al guardar. */
export function useVisitMaterials(visitId: string): VisitMaterialsResult {
  const result = useQuery<Record<string, unknown>>(VISIT_MATERIALS_SQL, [visitId]);

  const materials = useMemo(() => result.data.map(visitMaterialFromRow), [result.data]);
  const summary = useMemo(() => summarizeMaterials(materials), [materials]);
  const materialIds = useMemo(
    () => new Set(materials.map((material) => material.materialId)),
    [materials],
  );

  const refreshQuery = result.refresh;
  const refresh = useCallback(() => {
    void Promise.resolve(refreshQuery?.()).catch(() => undefined);
  }, [refreshQuery]);

  return {
    materials,
    summary,
    materialIds,
    isLoading: result.isLoading,
    hasError: Boolean(result.error),
    refresh,
  };
}
