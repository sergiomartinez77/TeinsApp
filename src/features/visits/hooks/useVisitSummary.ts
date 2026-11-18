import { useQuery } from '@powersync/react';

import { useVisitAnnotation } from '@/features/annotations/hooks/useVisitAnnotation';
import { useVisitFormResponses } from '@/features/forms/hooks/useVisitForms';
import { useVisitMaterials } from '@/features/materials/hooks/useVisitMaterials';
import { VISIT_PHOTO_STATS_SQL } from '@/features/photos/services/photo.queries';
import type { Visit } from '@/models/visit.model';

import {
  annotationsStatusText,
  formsStatusText,
  materialsStatusText,
  photosStatusText,
  sectionStatusText,
  type SectionStatuses,
} from '../services/visit-summary';

const toCount = (value: unknown): number => {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
};

/**
 * Línea de estado de cada sección de la visita para el resumen. Reúne las
 * consultas reactivas de cada sección: el texto se actualiza solo. Si una
 * consulta falla, solo su sección muestra "No disponible".
 */
export function useVisitSummary(technicianId: string, visit: Visit): SectionStatuses {
  const forms = useVisitFormResponses(visit.id);
  const materials = useVisitMaterials(visit.id);
  const annotation = useVisitAnnotation(visit.id);
  // Solo se cuentan las fotos: no hace falta cargar las filas.
  const photoStats = useQuery<{ total: unknown; pending: unknown }>(VISIT_PHOTO_STATS_SQL, [
    visit.id,
    technicianId,
  ]);

  const statsRow = photoStats.data[0];
  const photoTotal = toCount(statsRow?.total);
  const photoPending = toCount(statsRow?.pending);
  const photoState = { isLoading: photoStats.isLoading, hasError: Boolean(photoStats.error) };
  const elementCount = annotation.annotation?.elements.length ?? 0;

  return {
    'form-select': sectionStatusText(forms, () => formsStatusText(forms.responses)),
    materials: sectionStatusText(materials, () => materialsStatusText(materials.summary)),
    photos: sectionStatusText(photoState, () => photosStatusText(photoTotal, photoPending)),
    annotations: sectionStatusText(annotation, () => annotationsStatusText(elementCount)),
  };
}
