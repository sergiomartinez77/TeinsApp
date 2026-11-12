import { Button } from '@/components/ui';
import type { VisitStatus } from '@/models/visit.model';
import { colors } from '@/theme';

export interface VisitActionBarProps {
  status: VisitStatus;
  onStart: () => void;
  onComplete: () => void;
  isBusy: boolean;
}

/**
 * Acción principal según el estado:
 * asignada → "Iniciar visita"; en progreso → "Finalizar visita"; resto → ninguna.
 */
export function VisitActionBar({ status, onStart, onComplete, isBusy }: VisitActionBarProps) {
  if (status === 'assigned') {
    return (
      <Button
        label="Iniciar visita"
        icon="play-arrow"
        color={colors.success}
        onPress={onStart}
        loading={isBusy}
        testID="visit-start"
      />
    );
  }
  if (status === 'inProgress') {
    return (
      <Button
        label="Finalizar visita"
        icon="check"
        onPress={onComplete}
        loading={isBusy}
        testID="visit-complete"
      />
    );
  }
  return null;
}
