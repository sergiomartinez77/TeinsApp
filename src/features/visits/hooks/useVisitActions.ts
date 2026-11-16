import { usePowerSync } from '@powersync/react';
import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { useRequiredUser } from '@/hooks/useCurrentUser';
import type { Visit } from '@/models/visit.model';
import type { AppError } from '@/types/errors';
import { unwrapResult as unwrap, userErrorMessage } from '@/utils/result.utils';

import { completeVisit, createVisit, startVisit } from '../services/visit.service';
import type { CreateVisitInput } from '../validation';

function showError(title: string) {
  return (error: AppError) => Alert.alert(title, userErrorMessage(error));
}

/**
 * Acciones sobre visitas. Todas escriben primero en la base local,
 * así que funcionan sin conexión; la interfaz se actualiza sola por
 * las consultas reactivas.
 */
export function useVisitActions() {
  const db = usePowerSync();
  const user = useRequiredUser();

  const create = useMutation<Visit, AppError, CreateVisitInput>({
    mutationFn: (input) => unwrap(createVisit(db, user, input)),
  });

  const start = useMutation<Visit, AppError, string>({
    mutationFn: (visitId) => unwrap(startVisit(db, user.id, visitId)),
    onError: showError('No se pudo iniciar la visita'),
  });

  const complete = useMutation<Visit, AppError, string>({
    mutationFn: (visitId) => unwrap(completeVisit(db, user.id, visitId)),
    onError: showError('No se pudo finalizar la visita'),
  });

  return { create, start, complete };
}
