import { usePowerSync } from '@powersync/react';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useRequiredUser } from '@/hooks/useCurrentUser';
import { visitScopeFor } from '@/models/visit.model';
import type { AppError } from '@/types/errors';
import { unwrapResult as unwrap, userErrorMessage } from '@/utils/result.utils';

import {
  generateVisitReportPdf,
  shareVisitReport,
  type VisitReportFile,
} from '../services/visit-report.service';

/** Paso en curso: generar el PDF o abrir la hoja de compartir. */
export type VisitReportStep = 'generating' | 'sharing';

export const REPORT_ERROR_TITLE = 'No se pudo compartir el PDF';

export interface VisitReportState {
  /** Genera el PDF (sin conexión) y abre la hoja de compartir del sistema. */
  shareReport: () => void;
  isBusy: boolean;
  step: VisitReportStep | null;
  /** Mensaje del último error, apto para el usuario; `null` si no hubo. */
  error: string | null;
  /** Último PDF generado. */
  file: VisitReportFile | null;
}

/**
 * Informe PDF de la visita. Los errores se muestran con una alerta (como el
 * resto de acciones de la visita) y quedan en `error`.
 */
export function useVisitReport(visitId: string): VisitReportState {
  const db = usePowerSync();
  const user = useRequiredUser();
  const [step, setStep] = useState<VisitReportStep | null>(null);

  const mutation = useMutation<VisitReportFile, AppError, void>({
    mutationFn: async () => {
      setStep('generating');
      const file = await unwrap(
        generateVisitReportPdf(db, visitScopeFor(user), visitId, {
          technicianName: user.fullName ?? (user.email || null),
          currentUserId: user.id,
        }),
      );
      setStep('sharing');
      await unwrap(shareVisitReport(file.uri));
      return file;
    },
    onError: (error) => Alert.alert(REPORT_ERROR_TITLE, userErrorMessage(error)),
    onSettled: () => setStep(null),
  });

  return {
    shareReport: () => mutation.mutate(),
    isBusy: mutation.isPending,
    step,
    error: mutation.error ? userErrorMessage(mutation.error) : null,
    file: mutation.data ?? null,
  };
}
