import { useQuery } from '@powersync/react';
import { useMemo } from 'react';

import { useVisitAnnotation } from '@/features/annotations/hooks/useVisitAnnotation';
import { useFormResponse } from '@/features/forms/hooks/useFormResponse';
import { useFormTemplates } from '@/features/forms/hooks/useFormTemplates';
import { resolveTemplateForResponse } from '@/features/forms/services/template.service';
import { useVisitMaterials } from '@/features/materials/hooks/useVisitMaterials';
import { VISIT_PHOTO_STATS_SQL } from '@/features/photos/services/photo.queries';
import type { Visit } from '@/models/visit.model';

import {
  annotationsStatusText,
  formStatusText,
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
  const form = useFormResponse(visit.id);
  const templates = useFormTemplates();
  const materials = useVisitMaterials(visit.id);
  const annotation = useVisitAnnotation(visit.id);
  // Solo se cuentan las fotos: no hace falta cargar las filas.
  const photoStats = useQuery<{ total: unknown; pending: unknown }>(VISIT_PHOTO_STATS_SQL, [
    visit.id,
    technicianId,
  ]);

  const { response } = form;
  const templateName = useMemo(() => {
    // Si no se pueden leer las plantillas, se muestra solo el estado del formulario.
    if (!response || templates.hasError) return null;
    return resolveTemplateForResponse(templates.catalog, response, visit.visitType)?.name ?? null;
  }, [response, templates.catalog, templates.hasError, visit.visitType]);

  const statsRow = photoStats.data[0];
  const photoTotal = toCount(statsRow?.total);
  const photoPending = toCount(statsRow?.pending);
  const photoState = { isLoading: photoStats.isLoading, hasError: Boolean(photoStats.error) };
  const elementCount = annotation.annotation?.elements.length ?? 0;

  return {
    'form-select': sectionStatusText(form, () => formStatusText(response, templateName)),
    materials: sectionStatusText(materials, () => materialsStatusText(materials.summary)),
    photos: sectionStatusText(photoState, () => photosStatusText(photoTotal, photoPending)),
    annotations: sectionStatusText(annotation, () => annotationsStatusText(elementCount)),
  };
}
