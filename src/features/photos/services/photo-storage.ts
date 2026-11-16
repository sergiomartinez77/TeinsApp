import { PHOTOS } from '@/constants/app.constants';
import { appConfig } from '@/constants/config';
import { getSupabase } from '@/services/supabase/client';

/**
 * Fotografías en Supabase Storage (bucket privado `visit-photos`).
 *
 * La subida usa el cliente de Supabase con el contenido del archivo como
 * `ArrayBuffer`: es la forma que funciona en React Native (allí no hay `Blob`
 * de archivos locales fiable) y reutiliza la sesión y el refresco del token
 * del propio cliente.
 */

/** Almacenamiento remoto que usa el gestor de subidas (inyectable en tests). */
export interface RemotePhotoStorage {
  /** Sube (o sobrescribe) el JPEG en la ruta indicada. Lanza si falla. */
  upload: (storagePath: string, content: ArrayBuffer) => Promise<void>;
  /** URL del objeto (no firmada) que se guarda en `storage_url`. */
  objectUrl: (storagePath: string) => string;
}

/** Duración de las URL firmadas para mostrar fotos sin archivo local. */
export const SIGNED_URL_SECONDS = 60 * 60;

/** `${supabaseUrl}/storage/v1/object/visit-photos/<storage_path>` */
export function photoObjectUrl(supabaseUrl: string, storagePath: string): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/${PHOTOS.bucket}/${storagePath}`;
}

export const supabasePhotoStorage: RemotePhotoStorage = {
  upload: async (storagePath, content) => {
    const { error } = await getSupabase()
      .storage.from(PHOTOS.bucket)
      // `upsert`: reintentar la misma foto sobrescribe el objeto (idempotente).
      .upload(storagePath, content, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
  },
  objectUrl: (storagePath) => photoObjectUrl(appConfig.supabaseUrl, storagePath),
};

/** URL firmada temporal (1 h) para ver una foto que ya no está en el dispositivo. */
export async function createSignedPhotoUrl(storagePath: string): Promise<string> {
  const { data, error } = await getSupabase()
    .storage.from(PHOTOS.bucket)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
