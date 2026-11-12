import { useQuery } from '@powersync/react';
import { useCallback, useMemo, useState } from 'react';

import { PAGE_SIZE } from '@/constants/app.constants';
import { catalogMaterialFromRow, type CatalogMaterial } from '@/models/material.model';

import { buildCatalogQuery } from '../services/material.queries';

export interface MaterialsCatalogResult {
  materials: CatalogMaterial[];
  isLoading: boolean;
  hasError: boolean;
  /** Hay más materiales de los mostrados. */
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Catálogo de materiales activos, reactivo, con búsqueda por código y nombre.
 *
 * La paginación amplía el límite de la consulta de página en página (30):
 * la lista sigue siendo reactiva si el catálogo cambia al sincronizar.
 */
export function useMaterialsCatalog(search: string): MaterialsCatalogResult {
  const [paging, setPaging] = useState({ scope: search, pages: 1 });
  // Al cambiar la búsqueda se vuelve a la primera página.
  const pages = paging.scope === search ? paging.pages : 1;
  const pageLimit = pages * PAGE_SIZE.materials;

  // Se pide una fila de más para saber si quedan materiales por cargar.
  const query = useMemo(
    () => buildCatalogQuery({ search, limit: pageLimit + 1 }),
    [search, pageLimit],
  );
  const result = useQuery<Record<string, unknown>>(query.sql, query.parameters);

  const hasMore = result.data.length > pageLimit;
  const materials = useMemo(
    () => result.data.slice(0, pageLimit).map(catalogMaterialFromRow),
    [result.data, pageLimit],
  );

  const loadMore = useCallback(() => {
    if (hasMore) setPaging({ scope: search, pages: pages + 1 });
  }, [hasMore, search, pages]);

  return {
    materials,
    isLoading: result.isLoading,
    hasError: Boolean(result.error),
    hasMore,
    loadMore,
  };
}
