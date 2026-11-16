import { Directory, File, Paths } from 'expo-file-system';

import { PHOTOS } from '@/constants/app.constants';

/**
 * Archivos de fotografías en el dispositivo (envoltorio fino de expo-file-system).
 *
 * En la base se guarda la ruta RELATIVA (`teins_photos/<id>.jpg`): en iOS la
 * ruta absoluta del contenedor de la app cambia entre actualizaciones, así que
 * la absoluta se resuelve en el momento de usarla.
 */

/** Operaciones de archivo que usan los servicios de fotos (inyectables en tests). */
export interface PhotoFileSystem {
  /**
   * Mueve un archivo temporal (p. ej. el JPEG comprimido) a su ruta definitiva
   * y devuelve su tamaño en bytes. Crea la carpeta si no existe.
   */
  save: (sourceUri: string, relativePath: string) => Promise<{ size: number }>;
  /** Borra el archivo; no falla si ya no existe. */
  remove: (relativePath: string) => Promise<void>;
  exists: (relativePath: string) => boolean;
  /** Contenido del archivo, para subirlo. */
  read: (relativePath: string) => Promise<ArrayBuffer>;
  /** URI absoluta (`file://…`) para mostrar el archivo. */
  absoluteUri: (relativePath: string) => string;
}

/** Ruta relativa de la foto dentro del directorio de documentos. */
export function photoRelativePath(photoId: string): string {
  return `${PHOTOS.localDirectory}/${photoId}.jpg`;
}

const fileAt = (relativePath: string) => new File(Paths.document, relativePath);

/** Sistema de archivos real del dispositivo. */
export const devicePhotoFiles: PhotoFileSystem = {
  save: async (sourceUri, relativePath) => {
    const folder = new Directory(Paths.document, PHOTOS.localDirectory);
    folder.create({ intermediates: true, idempotent: true });
    const destination = fileAt(relativePath);
    const source = new File(sourceUri);
    await source.move(destination, { overwrite: true });
    return { size: destination.size };
  },
  remove: async (relativePath) => {
    const file = fileAt(relativePath);
    if (file.exists) file.delete();
  },
  exists: (relativePath) => relativePath.length > 0 && fileAt(relativePath).exists,
  read: (relativePath) => fileAt(relativePath).arrayBuffer(),
  absoluteUri: (relativePath) => fileAt(relativePath).uri,
};

/** Tamaño en bytes de un archivo por URI (0 si no existe). */
export function fileSizeAt(uri: string): number {
  const file = new File(uri);
  return file.exists ? file.size : 0;
}

/**
 * Borra un archivo temporal por URI sin lanzar errores. Solo actúa dentro de
 * la caché de la app: nunca toca archivos del usuario (p. ej. de su galería).
 */
export function discardFile(uri: string): void {
  try {
    if (!uri.startsWith(Paths.cache.uri)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Archivo temporal: si no se puede borrar, el sistema limpiará la caché.
  }
}
