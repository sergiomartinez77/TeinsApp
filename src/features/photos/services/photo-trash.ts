import { File } from 'expo-file-system';

import { PHOTOS } from '@/constants/app.constants';
import { scopedLogger } from '@/utils/logger';

import { photoTrashDirectory } from './photo-files';

const log = scopedLogger('photos');

/**
 * Papelera temporal de fotos eliminadas que no estaban subidas.
 *
 * La antigüedad se mide desde el nombre del archivo (`<epochMs>_<photoId>.jpg`):
 * mover un archivo conserva su fecha de modificación (la de la captura), así
 * que esa fecha no sirve para saber cuándo entró en la papelera.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_NAME = /^(\d{1,15})_([^/\\]+)\.jpg$/;

/** Nombre del archivo en la papelera, con el momento de entrada. */
export function photoTrashName(photoId: string, now: Date = new Date()): string {
  return `${now.getTime()}_${photoId}.jpg`;
}

/** Momento de entrada en la papelera, o `null` si el nombre no se reconoce. */
export function trashEnteredAt(name: string): number | null {
  const match = TRASH_NAME.exec(name);
  if (!match?.[1]) return null;
  const epoch = Number(match[1]);
  return Number.isSafeInteger(epoch) ? epoch : null;
}

/**
 * Si el archivo debe borrarse: tiene 7 días o más, el nombre no se reconoce,
 * o su fecha está más de un día en el futuro (reloj del dispositivo cambiado).
 */
export function isTrashExpired(
  name: string,
  now: Date,
  retentionDays: number = PHOTOS.trashRetentionDays,
): boolean {
  const entered = trashEnteredAt(name);
  if (entered === null) return true;
  const age = now.getTime() - entered;
  return age >= retentionDays * DAY_MS || age < -DAY_MS;
}

/** Acceso a la carpeta de la papelera (inyectable en tests). */
export interface PhotoTrashStore {
  /** Nombres de los archivos; vacío si la carpeta no existe. */
  list: () => string[];
  remove: (name: string) => void;
}

export const devicePhotoTrash: PhotoTrashStore = {
  list: () => {
    const trash = photoTrashDirectory();
    if (!trash.exists) return [];
    return trash
      .list()
      .filter((entry) => entry instanceof File)
      .map((entry) => entry.name);
  },
  remove: (name) => {
    const file = new File(photoTrashDirectory(), name);
    if (file.exists) file.delete();
  },
};

/**
 * Borra de la papelera los archivos caducados. Nunca lanza: cualquier fallo
 * solo se registra. Devuelve cuántos archivos se borraron.
 */
export async function purgePhotoTrash(
  store: PhotoTrashStore = devicePhotoTrash,
  now: Date = new Date(),
): Promise<number> {
  let names: string[];
  try {
    names = store.list();
  } catch (error) {
    log.warn('No se pudo revisar la papelera de fotografías', error);
    return 0;
  }

  let removed = 0;
  for (const name of names) {
    if (!isTrashExpired(name, now)) continue;
    try {
      store.remove(name);
      removed += 1;
    } catch (error) {
      log.warn('No se pudo borrar un archivo de la papelera de fotografías', error);
    }
  }
  return removed;
}
