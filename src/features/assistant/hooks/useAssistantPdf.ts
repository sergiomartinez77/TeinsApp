import { usePowerSync } from '@powersync/react';
import { useCallback, useState } from 'react';

import { generateVisitReportPdf, shareVisitReport, type ReportDatabase } from '@/features/reports';
import type { VisitReportStep } from '@/features/reports/hooks/useVisitReport';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { visitScopeFor } from '@/models/visit.model';
import { settleResult } from '@/utils/result.utils';

export interface AssistantPdfState {
  /** Genera el PDF en el teléfono y abre la hoja de compartir. */
  share: () => void;
  step: VisitReportStep | null;
  /** Mensaje del último error, apto para el usuario. */
  error: string | null;
  /** Nombre del último PDF compartido. */
  fileName: string | null;
}

/**
 * "Compartir PDF" desde el asistente: usa la misma API de informes que la
 * pantalla de la visita (genera el PDF sin conexión con los datos locales).
 * El error se muestra en la tarjeta del chat.
 */
export function useAssistantPdf(visitId: string): AssistantPdfState {
  const db: ReportDatabase = usePowerSync();
  const user = useRequiredUser();
  const [step, setStep] = useState<VisitReportStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const share = useCallback(() => {
    if (step) return;
    setError(null);
    setStep('generating');
    void (async () => {
      const file = await settleResult(
        generateVisitReportPdf(db, visitScopeFor(user), visitId, {
          technicianName: user.fullName ?? (user.email || null),
          currentUserId: user.id,
        }),
      );
      if (!file.ok) {
        setError(file.error.message);
        setStep(null);
        return;
      }
      setStep('sharing');
      const shared = await settleResult(shareVisitReport(file.data.uri));
      if (shared.ok) setFileName(file.data.fileName);
      else setError(shared.error.message);
      setStep(null);
    })();
  }, [db, step, user, visitId]);

  return { share, step, error, fileName };
}
