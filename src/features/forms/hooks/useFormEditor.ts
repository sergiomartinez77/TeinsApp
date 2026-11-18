import { zodResolver } from '@hookform/resolvers/zod';
import { usePowerSync } from '@powersync/react';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, useFormState, type FieldErrors } from 'react-hook-form';
import { Alert } from 'react-native';

import type { FormResponse, FormTemplate, FormValues } from '@/models/form.model';
import type { AppError } from '@/types/errors';
import { unwrapResult, userErrorMessage } from '@/utils/result.utils';

import {
  buildFormSchema,
  draftFromValues,
  draftToValues,
  sectionsWithErrors,
  type FormDraft,
} from '../services/form-schema';
import { completeFormResponse, saveFormResponse } from '../services/response.service';

import { useAutosave } from './useAutosave';

export interface UseFormEditorOptions {
  visitId: string;
  /** Técnico de la sesión: solo se escribe en sus propias visitas. */
  technicianId: string;
  template: FormTemplate;
  /** Respuesta que se edita, si ya existe (varios formularios por visita). */
  responseId?: string;
  /** Respuestas ya guardadas; solo se usan al abrir el formulario. */
  initialValues: FormValues;
  readOnly: boolean;
}

/**
 * Estado del formulario técnico: valores (React Hook Form), validación con el
 * esquema de la plantilla, autoguardado, navegación por secciones y completar.
 *
 * La validación solo corre al pulsar "Completar formulario".
 */
export function useFormEditor({
  visitId,
  technicianId,
  template,
  responseId,
  initialValues,
  readOnly,
}: UseFormEditorOptions) {
  const db = usePowerSync();
  // Los valores iniciales se fijan al abrir: los guardados posteriores no reinician el formulario.
  const [defaultValues] = useState(() => draftFromValues(template, initialValues));
  const resolver = useMemo(() => zodResolver(buildFormSchema(template)), [template]);

  const { control, getValues, handleSubmit, clearErrors, subscribe } = useForm<
    FormDraft,
    unknown,
    FormDraft
  >({
    resolver,
    defaultValues,
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
  });
  const { errors } = useFormState({ control });

  const toInput = useCallback(
    (draft: FormDraft) => ({
      visitId,
      template,
      responseId,
      values: draftToValues(template, draft),
    }),
    [visitId, template, responseId],
  );

  const save = useCallback(
    async (draft: FormDraft) => (await saveFormResponse(db, technicianId, toInput(draft))).ok,
    [db, technicianId, toInput],
  );
  const { status, schedule, flush, cancel } = useAutosave<FormDraft>({ save });

  // Cada cambio de un campo programa el autoguardado.
  useEffect(() => {
    if (readOnly) return;
    return subscribe({
      formState: { values: true },
      callback: ({ values }) => schedule({ ...values }),
    });
  }, [readOnly, subscribe, schedule]);

  const [sectionIndex, setSectionIndex] = useState(0);
  const errorSectionIds = sectionsWithErrors(template, Object.keys(errors));

  const saveNow = useCallback(() => {
    if (readOnly) return;
    schedule({ ...getValues() });
    void flush();
  }, [readOnly, schedule, getValues, flush]);

  const completion = useMutation<FormResponse, AppError, FormDraft>({
    mutationFn: async (draft) => {
      // Se descarta el autoguardado pendiente (estos valores lo incluyen) y se
      // espera a que termine el que esté en curso.
      cancel();
      await flush();
      return unwrapResult(completeFormResponse(db, technicianId, toInput(draft)));
    },
    onError: (error) => {
      schedule({ ...getValues() });
      Alert.alert('No se pudo completar el formulario', userErrorMessage(error));
    },
  });

  const onInvalid = (fieldErrors: FieldErrors<FormDraft>) => {
    const [first] = sectionsWithErrors(template, Object.keys(fieldErrors));
    const index = template.sections.findIndex((section) => section.id === first);
    if (index >= 0) setSectionIndex(index);
  };

  const onValid = (draft: FormDraft) =>
    Alert.alert(
      'Completar formulario',
      'Al completarlo ya no podrás modificar las respuestas. ¿Quieres completarlo?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Completar', onPress: () => completion.mutate(draft) },
      ],
    );

  const complete = () => {
    if (readOnly) return;
    void handleSubmit(onValid, onInvalid)();
  };

  return {
    control,
    clearErrors,
    sectionIndex,
    setSectionIndex,
    errorSectionIds,
    autosaveStatus: status,
    saveNow,
    complete,
    isCompleting: completion.isPending,
  };
}
