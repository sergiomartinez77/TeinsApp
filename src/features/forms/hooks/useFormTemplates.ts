import { useQuery } from '@powersync/react';
import { useMemo } from 'react';

import { buildTemplateCatalog, type TemplateCatalog } from '../services/template.service';

const TEMPLATES_SQL = 'SELECT * FROM form_templates';

export interface FormTemplatesResult {
  catalog: TemplateCatalog;
  isLoading: boolean;
  hasError: boolean;
}

/**
 * Plantillas de formulario: las sincronizadas en la base local más las de
 * respaldo incluidas en la app. Reactivo: se actualiza al sincronizar.
 */
export function useFormTemplates(): FormTemplatesResult {
  const result = useQuery<Record<string, unknown>>(TEMPLATES_SQL);
  const catalog = useMemo(() => buildTemplateCatalog(result.data), [result.data]);

  return { catalog, isLoading: result.isLoading, hasError: Boolean(result.error) };
}
