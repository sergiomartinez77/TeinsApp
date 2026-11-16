import { usePowerSync } from '@powersync/react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Linking } from 'react-native';

import { useRequiredUser } from '@/hooks/useCurrentUser';
import type { VisitPhoto } from '@/models/photo.model';
import type { AppError, Result } from '@/types/errors';

import { captureImage, type PhotoSource } from '../services/photo-capture';
import { devicePhotoFiles, discardFile } from '../services/photo-files';
import { requestPhotoUpload } from '../services/photo-uploader';
import { addPhoto, deletePhoto } from '../services/photo.service';

/** Convierte un `Result` fallido en excepción para que la mutación lo trate como error. */
async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw settled.error;
  return settled.data;
}

/** Aviso de error; si falta un permiso, ofrece abrir los ajustes del dispositivo. */
function showError(title: string, error: AppError): void {
  if (error.kind === 'permission') {
    Alert.alert(title, error.message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Abrir configuración', onPress: () => void Linking.openSettings() },
    ]);
    return;
  }
  Alert.alert(title, error.message);
}

/**
 * Acciones sobre las fotos de una visita. Se guardan primero en el
 * dispositivo (funcionan sin conexión) y el gestor de subidas las envía.
 */
export function usePhotoActions(visitId: string) {
  const db = usePowerSync();
  const user = useRequiredUser();

  /** Toma o elige una foto. Devuelve `null` si el técnico canceló. */
  const capture = useMutation<VisitPhoto | null, AppError, PhotoSource>({
    mutationFn: async (source) => {
      const image = await unwrap(captureImage(source));
      if (!image) return null;
      const saved = await addPhoto(db, devicePhotoFiles, user.id, { visitId, image });
      // Si no se guardó, el JPEG temporal ya no sirve.
      if (!saved.ok) discardFile(image.uri);
      return unwrap(Promise.resolve(saved));
    },
    onSuccess: (photo) => {
      if (photo) requestPhotoUpload();
    },
    onError: (error) => showError('No se pudo guardar la fotografía', error),
  });

  const remove = useMutation<void, AppError, string>({
    mutationFn: (photoId) =>
      unwrap(deletePhoto(db, devicePhotoFiles, user.id, { visitId, photoId })),
    onError: (error) => showError('No se pudo eliminar la fotografía', error),
  });

  return { capture, remove, isBusy: capture.isPending || remove.isPending };
}
