import { photoFromRow, type VisitPhoto } from '@/models/photo.model';
import { isEditable, parseVisitStatus } from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

import type { CompressedImage } from './photo-capture';
import { photoRelativePath, type PhotoFileSystem } from './photo-files';
import { photoTrashName } from './photo-trash';
import {
  DELETE_PHOTO_SQL,
  INSERT_PHOTO_SQL,
  OWN_VISIT_SQL,
  PHOTO_BY_ID_SQL,
} from './photo.queries';

const log = scopedLogger('photos');

/** Operaciones de base de datos que usa el servicio (subconjunto de PowerSync). */
export interface PhotoTransaction {
  execute: (sql: string, parameters?: unknown[]) => Promise<unknown>;
  getOptional: <T>(sql: string, parameters?: unknown[]) => Promise<T | null>;
}

export interface PhotoDatabase {
  writeTransaction: <T>(callback: (tx: PhotoTransaction) => Promise<T>) => Promise<T>;
}

export const PHOTO_SERVICE_MESSAGES = {
  visitClosed: 'La visita está cerrada y sus fotografías ya no se pueden modificar.',
  visitNotFound: 'No se encontró la visita. Es posible que ya no esté asignada a ti.',
  photoNotFound: 'No se encontró la fotografía. Es posible que ya se haya eliminado.',
} as const;

export interface AddPhotoInput {
  visitId: string;
  /** JPEG ya comprimido en un archivo temporal. */
  image: Pick<CompressedImage, 'uri' | 'width' | 'height'>;
}

export interface DeletePhotoInput {
  visitId: string;
  photoId: string;
}

/** Señal interna para deshacer la transacción con un error ya tipado. */
class PhotoRuleError extends Error {
  constructor(readonly result: Result<never>) {
    super('photo-rule');
  }
}

const rule = (message: string, code: string) =>
  new PhotoRuleError(err(validationError(message, code)));

/** Comprueba que la visita existe, es del técnico y sigue abierta. */
async function assertEditableVisit(
  tx: PhotoTransaction,
  technicianId: string,
  visitId: string,
): Promise<void> {
  const visit = await tx.getOptional<Record<string, unknown>>(OWN_VISIT_SQL, [
    visitId,
    technicianId,
  ]);
  if (!visit) throw rule(PHOTO_SERVICE_MESSAGES.visitNotFound, 'not_found');
  if (!isEditable({ status: parseVisitStatus(visit.status) })) {
    throw rule(PHOTO_SERVICE_MESSAGES.visitClosed, 'visit_closed');
  }
}

function failure(error: unknown, message: string): Result<never> {
  if (error instanceof PhotoRuleError) return error.result;
  log.error(message, error);
  return err(appError('database', { cause: error }));
}

/**
 * Guarda una fotografía nueva: mueve el JPEG a `teins_photos/<id>.jpg` y
 * registra la fila con `sync_status = 'local'`. La foto aparece al instante en
 * la galería (consulta reactiva); el gestor de subidas la enviará después.
 *
 * Si falla el registro después de escribir el archivo, ese archivo se borra
 * para no dejar huérfanos. Nunca lanza: los errores vuelven en el `Result`.
 */
export async function addPhoto(
  db: PhotoDatabase,
  files: PhotoFileSystem,
  technicianId: string,
  input: AddPhotoInput,
  now: Date = new Date(),
): Promise<Result<VisitPhoto>> {
  const id = generateId();
  const localPath = photoRelativePath(id);
  const created = { file: false };

  try {
    const photo = await db.writeTransaction(async (tx) => {
      await assertEditableVisit(tx, technicianId, input.visitId);

      const { size } = await files.save(input.image.uri, localPath);
      created.file = true;

      const row: Record<string, unknown> = {
        id,
        visit_id: input.visitId,
        form_field_id: null,
        local_path: localPath,
        storage_path: null,
        storage_url: null,
        caption: null,
        sync_status: 'local',
        captured_at: now.toISOString(),
        uploaded_at: null,
        file_size_bytes: size,
        width: input.image.width,
        height: input.image.height,
      };
      await tx.execute(INSERT_PHOTO_SQL, [
        row.id,
        row.visit_id,
        row.form_field_id,
        row.local_path,
        row.storage_path,
        row.storage_url,
        row.caption,
        row.sync_status,
        row.captured_at,
        row.uploaded_at,
        row.file_size_bytes,
        row.width,
        row.height,
      ]);
      return photoFromRow(row);
    });
    return ok(photo);
  } catch (error) {
    if (created.file) {
      await files
        .remove(localPath)
        .catch((removeError: unknown) =>
          log.warn('No se pudo borrar el archivo de una foto no registrada', removeError),
        );
    }
    return failure(error, 'No se pudo guardar la fotografía');
  }
}

/**
 * Elimina una fotografía de la visita (borra la fila).
 *
 * Solo DESPUÉS de confirmar el borrado de la fila se toca el archivo local
 * (si la transacción falla, el archivo queda intacto):
 * - Foto `uploaded`: el archivo se borra (la copia está en el servidor).
 * - Cualquier otro estado: el archivo se mueve a la papelera temporal de la
 *   caché (`teins_photos_trash/<epochMs>_<id>.jpg`), que se vacía a los 7 días
 *   (`purgePhotoTrash`) o antes si el sistema necesita espacio.
 * Un fallo con el archivo no es un error para el técnico: solo se registra.
 * El objeto remoto no se toca: solo un administrador puede borrarlo.
 */
export async function deletePhoto(
  db: PhotoDatabase,
  files: PhotoFileSystem,
  technicianId: string,
  input: DeletePhotoInput,
  now: Date = new Date(),
): Promise<Result<void>> {
  let deleted: VisitPhoto;
  try {
    deleted = await db.writeTransaction(async (tx) => {
      await assertEditableVisit(tx, technicianId, input.visitId);
      const row = await tx.getOptional<Record<string, unknown>>(PHOTO_BY_ID_SQL, [
        input.photoId,
        input.visitId,
      ]);
      if (!row) throw rule(PHOTO_SERVICE_MESSAGES.photoNotFound, 'photo_not_found');
      await tx.execute(DELETE_PHOTO_SQL, [input.photoId]);
      return photoFromRow(row);
    });
  } catch (error) {
    return failure(error, 'No se pudo eliminar la fotografía');
  }

  if (!deleted.localPath) return ok(undefined);
  try {
    if (deleted.syncStatus === 'uploaded') {
      await files.remove(deleted.localPath);
    } else {
      await files.moveToTrash(deleted.localPath, photoTrashName(deleted.id, now));
    }
  } catch (error) {
    // La fila ya no existe: un archivo sobrante o ausente no afecta al técnico.
    log.warn('No se pudo retirar el archivo de una foto eliminada', error);
  }
  return ok(undefined);
}
