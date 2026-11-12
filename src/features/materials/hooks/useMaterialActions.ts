import { usePowerSync } from '@powersync/react';
import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { useRequiredUser } from '@/hooks/useCurrentUser';
import type { VisitMaterial } from '@/models/material.model';
import type { AppError, Result } from '@/types/errors';

import {
  addMaterialToVisit,
  removeVisitMaterial,
  updateVisitMaterial,
} from '../services/material.service';
import type { MaterialEntryInput } from '../validation';

/** Material del catálogo elegido, con su cantidad y observaciones. */
export interface NewMaterialEntry extends MaterialEntryInput {
  materialId: string;
}

/** Cambios de un material ya agregado. */
export interface MaterialChanges extends MaterialEntryInput {
  visitMaterialId: string;
}

/** Convierte un `Result` fallido en excepción para que la mutación lo trate como error. */
async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw settled.error;
  return settled.data;
}

/**
 * Acciones sobre los materiales de una visita. Escriben primero en la base
 * local (funcionan sin conexión) y la lista se actualiza sola.
 */
export function useMaterialActions(visitId: string) {
  const db = usePowerSync();
  const user = useRequiredUser();

  const add = useMutation<VisitMaterial, AppError, NewMaterialEntry>({
    mutationFn: (entry) => unwrap(addMaterialToVisit(db, user.id, { ...entry, visitId })),
  });

  const update = useMutation<VisitMaterial, AppError, MaterialChanges>({
    mutationFn: (changes) => unwrap(updateVisitMaterial(db, user.id, { ...changes, visitId })),
  });

  const remove = useMutation<void, AppError, string>({
    mutationFn: (visitMaterialId) =>
      unwrap(removeVisitMaterial(db, user.id, { visitId, visitMaterialId })),
    onError: (error) => Alert.alert('No se pudo quitar el material', error.message),
  });

  const isBusy = add.isPending || update.isPending || remove.isPending;

  return { add, update, remove, isBusy };
}
