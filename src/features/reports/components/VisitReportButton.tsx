import { Button } from '@/components/ui';
import { colors } from '@/theme';

import type { VisitReportStep } from '../hooks/useVisitReport';

export interface VisitReportButtonProps {
  onPress: () => void;
  /** Paso en curso; `null` si no se está generando nada. */
  step: VisitReportStep | null;
}

export const REPORT_BUTTON_LABELS = {
  idle: 'Compartir PDF',
  generating: 'Generando PDF...',
  sharing: 'Abriendo para compartir...',
} as const;

/**
 * Botón del informe PDF de la visita: lo genera en el teléfono (también sin
 * conexión) y abre la hoja de compartir. Inactivo mientras trabaja.
 */
export function VisitReportButton({ onPress, step }: VisitReportButtonProps) {
  const label = step ? REPORT_BUTTON_LABELS[step] : REPORT_BUTTON_LABELS.idle;
  return (
    <Button
      label={label}
      icon="picture-as-pdf"
      variant="outlined"
      color={colors.primary}
      onPress={onPress}
      loading={step !== null}
      accessibilityLabel={step ? label : 'Generar y compartir el informe PDF de la visita'}
      accessibilityHint="Crea un PDF con los datos, formularios, materiales, fotos y planos de la visita y abre las opciones para enviarlo"
      testID="visit-report-pdf"
    />
  );
}
