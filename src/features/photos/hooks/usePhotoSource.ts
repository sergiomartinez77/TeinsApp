import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { VisitPhoto } from '@/models/photo.model';
import { scopedLogger } from '@/utils/logger';

import { devicePhotoFiles } from '../services/photo-files';
import { createSignedPhotoUrl, SIGNED_URL_SECONDS } from '../services/photo-storage';

const log = scopedLogger('photos');

export interface PhotoImageSource {
  uri: string;
  /** Clave de caché estable (la URL firmada cambia en cada petición). */
  cacheKey: string;
}

export interface PhotoSourceResult {
  source: PhotoImageSource | null;
  isLoading: boolean;
}

/**
 * Origen para mostrar una foto: el archivo local si existe; si no (p. ej. ya
 * subida y borrada del dispositivo), una URL firmada temporal pedida al
 * momento, porque el bucket es privado.
 */
export function usePhotoSource(
  photo: Pick<VisitPhoto, 'id' | 'localPath' | 'storagePath'>,
): PhotoSourceResult {
  const localUri = useMemo(() => {
    try {
      return devicePhotoFiles.exists(photo.localPath)
        ? devicePhotoFiles.absoluteUri(photo.localPath)
        : null;
    } catch (error) {
      log.warn('No se pudo comprobar el archivo de una foto', error);
      return null;
    }
  }, [photo.localPath]);

  const remotePath = localUri ? null : photo.storagePath;
  const signed = useQuery({
    queryKey: ['photo-signed-url', remotePath],
    queryFn: () => createSignedPhotoUrl(remotePath ?? ''),
    enabled: Boolean(remotePath),
    // Se renueva antes de que caduque la URL firmada (1 h).
    staleTime: (SIGNED_URL_SECONDS - 10 * 60) * 1000,
    gcTime: (SIGNED_URL_SECONDS - 5 * 60) * 1000,
    retry: false,
  });

  if (localUri) {
    return { source: { uri: localUri, cacheKey: `local-${photo.id}` }, isLoading: false };
  }
  if (remotePath && signed.data) {
    return { source: { uri: signed.data, cacheKey: `remote-${photo.id}` }, isLoading: false };
  }
  return { source: null, isLoading: Boolean(remotePath) && signed.isLoading };
}
