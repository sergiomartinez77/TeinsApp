import { useQuery } from '@powersync/react';
import { useMemo } from 'react';

import { responseFromRow, type FormResponse } from '@/models/form.model';

import {
  RESPONSE_BY_ID_SQL,
  RESPONSE_BY_TEMPLATE_SQL,
  RESPONSE_BY_VISIT_SQL,
  VISIT_RESPONSES_SQL,
} from '../services/response.service';

export interface VisitResponsesResult {
  responses: FormResponse[];
  isLoading: boolean;
  hasError: boolean;
}

/** Todos los formularios (respuestas) de la visita. Reactivo. */
export function useVisitFormResponses(visitId: string): VisitResponsesResult {
  const result = useQuery<Record<string, unknown>>(VISIT_RESPONSES_SQL, [visitId]);
  const responses = useMemo(() => result.data.map(responseFromRow), [result.data]);
  return { responses, isLoading: result.isLoading, hasError: Boolean(result.error) };
}

export interface FormResponseTarget {
  /** Respuesta concreta que se abre desde la lista. */
  responseId?: string;
  /** Plantilla del formulario (id de la base o del asset). */
  templateId?: string;
}

/**
 * Consulta de la respuesta que corresponde a la pantalla del formulario: por
 * id si se abre desde la lista; si no, la de la plantilla elegida; sin
 * ninguno de los dos, la primera de la visita (comportamiento anterior).
 */
export function formResponseQuery(
  visitId: string,
  target: FormResponseTarget,
): { sql: string; parameters: string[] } {
  if (target.responseId)
    return { sql: RESPONSE_BY_ID_SQL, parameters: [target.responseId, visitId] };
  if (target.templateId) {
    return { sql: RESPONSE_BY_TEMPLATE_SQL, parameters: [visitId, target.templateId] };
  }
  return { sql: RESPONSE_BY_VISIT_SQL, parameters: [visitId] };
}

export interface FormResponseForResult {
  response: FormResponse | null;
  isLoading: boolean;
  hasError: boolean;
}

/** Respuesta del formulario que se está editando (o `null` si aún no se empezó). Reactivo. */
export function useFormResponseFor(
  visitId: string,
  target: FormResponseTarget,
): FormResponseForResult {
  const { sql, parameters } = formResponseQuery(visitId, target);
  const result = useQuery<Record<string, unknown>>(sql, parameters);
  const row = result.data[0];
  const response = useMemo(() => (row ? responseFromRow(row) : null), [row]);
  return { response, isLoading: result.isLoading, hasError: Boolean(result.error) };
}
