import { useQuery } from '@powersync/react';
import { useCallback, useMemo, useState } from 'react';

import { PAGE_SIZE } from '@/constants/app.constants';
import { photoFromRow, type VisitPhoto } from '@/models/photo.model';

import { VISIT_PHOTO_COUNT_SQL, VISIT_PHOTOS_SQL } from '../services/photo.queries';

export interface VisitPhotosResult {
  photos: VisitPhoto[];
  /** Total de fotos de la visita (no solo las cargadas). */
  total: number;
  isLoading: boolean;
  hasError: boolean;
  /** Hay más fotos de las mostradas. */
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Fotos de la visita, reactivas (la nueva aparece al instante), de la más
 * reciente a la más antigua. La paginación amplía el límite de 20 en 20.
 */
export function useVisitPhotos(visitId: string): VisitPhotosResult {
  const [paging, setPaging] = useState({ scope: visitId, pages: 1 });
  const pages = paging.scope === visitId ? paging.pages : 1;
  const pageLimit = pages * PAGE_SIZE.photos;

  // Se pide una fila de más para saber si quedan fotos por cargar.
  const parameters = useMemo(() => [visitId, pageLimit + 1], [visitId, pageLimit]);
  const result = useQuery<Record<string, unknown>>(VISIT_PHOTOS_SQL, parameters);
  const countResult = useQuery<{ count: unknown }>(VISIT_PHOTO_COUNT_SQL, [visitId]);

  const hasMore = result.data.length > pageLimit;
  const photos = useMemo(
    () => result.data.slice(0, pageLimit).map(photoFromRow),
    [result.data, pageLimit],
  );
  const counted = Number(countResult.data[0]?.count ?? 0);
  const total = Number.isFinite(counted) ? Math.max(counted, photos.length) : photos.length;

  const loadMore = useCallback(() => {
    if (hasMore) setPaging({ scope: visitId, pages: pages + 1 });
  }, [hasMore, visitId, pages]);

  const refreshQuery = result.refresh;
  const refresh = useCallback(() => {
    void Promise.resolve(refreshQuery?.()).catch(() => undefined);
  }, [refreshQuery]);

  return {
    photos,
    total,
    isLoading: result.isLoading,
    hasError: Boolean(result.error),
    hasMore,
    loadMore,
    refresh,
  };
}
