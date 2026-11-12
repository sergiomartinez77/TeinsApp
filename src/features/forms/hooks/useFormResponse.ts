import { useQuery } from '@powersync/react';
import { useMemo } from 'react';

import type { FormResponse } from '@/models/form.model';

import { RESPONSE_BY_VISIT_SQL, responseFromRow } from '../services/response.service';

export interface FormResponseResult {
  response: FormResponse | null;
  isLoading: boolean;
  hasError: boolean;
}

/** Respuesta del formulario de la visita (o `null` si aún no se empezó). Reactivo. */
export function useFormResponse(visitId: string): FormResponseResult {
  const result = useQuery<Record<string, unknown>>(RESPONSE_BY_VISIT_SQL, [visitId]);
  const row = result.data[0];
  const response = useMemo(() => (row ? responseFromRow(row) : null), [row]);

  return { response, isLoading: result.isLoading, hasError: Boolean(result.error) };
}
