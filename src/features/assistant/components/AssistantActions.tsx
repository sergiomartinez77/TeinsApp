import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon } from '@/components/ui';
import { REPORT_BUTTON_LABELS } from '@/features/reports/components/VisitReportButton';
import { colors, radius, spacing, withAlpha } from '@/theme';

import { useAssistantPdf } from '../hooks/useAssistantPdf';
import type { AssistantAction } from '../services/engine';

export interface AssistantActionsProps {
  actions: readonly AssistantAction[];
  onSuggestion: (message: string) => void;
  onSelectVisit: (visitId: string, label: string) => void;
  onOpenInventory: () => void;
  /** Mientras el asistente responde, los chips no envían nada. */
  disabled?: boolean;
}

/** Chip tocable (sugerencia o visita a elegir). */
export function Chip({
  label,
  onPress,
  disabled = false,
  accessibilityHint,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <AppText variant="labelLarge" color={colors.primary} numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Tarjeta "Compartir PDF" de una visita: genera el PDF en el teléfono y lo comparte. */
export function SharePdfCard({ visitId, label }: { visitId: string; label: string }) {
  const pdf = useAssistantPdf(visitId);
  const buttonLabel = pdf.step ? REPORT_BUTTON_LABELS[pdf.step] : REPORT_BUTTON_LABELS.idle;
  return (
    <Card style={styles.card} testID={`assistant-pdf-${visitId}`}>
      <View style={styles.cardHeader}>
        <Icon name="picture-as-pdf" size={22} color={colors.error} />
        <AppText variant="titleSmall" style={styles.flex}>
          {label}
        </AppText>
      </View>
      <Button
        label={buttonLabel}
        icon="share"
        variant="outlined"
        onPress={pdf.share}
        loading={pdf.step !== null}
        accessibilityLabel={pdf.step ? buttonLabel : `Compartir PDF de ${label}`}
        accessibilityHint="Genera el informe en el teléfono y abre las opciones para enviarlo"
      />
      {pdf.error ? (
        <AppText variant="bodySmall" color={colors.error} accessibilityLiveRegion="polite">
          {pdf.error}
        </AppText>
      ) : null}
      {pdf.fileName && !pdf.error ? (
        <AppText variant="bodySmall" color={colors.textSecondary}>
          {`Último PDF: ${pdf.fileName}`}
        </AppText>
      ) : null}
    </Card>
  );
}

/** Acciones de una respuesta: tarjetas de PDF, botón de inventario y chips. */
export function AssistantActions({
  actions,
  onSuggestion,
  onSelectVisit,
  onOpenInventory,
  disabled = false,
}: AssistantActionsProps) {
  if (actions.length === 0) return null;
  const chips = actions.filter(
    (action) => action.type === 'suggestion' || action.type === 'select_visit',
  );
  return (
    <View style={styles.actions}>
      {actions.map((action, index) => {
        if (action.type === 'share_pdf') {
          return (
            <SharePdfCard
              key={`pdf-${action.visitId}`}
              visitId={action.visitId}
              label={action.label}
            />
          );
        }
        if (action.type === 'open_inventory') {
          return (
            <Button
              key={`inventory-${index}`}
              label="Abrir inventario"
              icon="inventory-2"
              variant="outlined"
              onPress={onOpenInventory}
              fullWidth={false}
            />
          );
        }
        return null;
      })}
      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((action) =>
            action.type === 'select_visit' ? (
              <Chip
                key={`visit-${action.visitId}`}
                label={action.label}
                disabled={disabled}
                accessibilityHint="Prepara el PDF de esta visita"
                onPress={() => onSelectVisit(action.visitId, action.label)}
              />
            ) : action.type === 'suggestion' ? (
              <Chip
                key={`suggestion-${action.message}`}
                label={action.label}
                disabled={disabled}
                accessibilityHint="Envía esta pregunta al asistente"
                onPress={() => onSuggestion(action.message)}
              />
            ) : null,
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: spacing.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.4),
    backgroundColor: colors.surface,
    maxWidth: '100%',
  },
  pressed: {
    backgroundColor: withAlpha(colors.primary, 0.08),
  },
  disabled: {
    opacity: 0.5,
  },
  card: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
