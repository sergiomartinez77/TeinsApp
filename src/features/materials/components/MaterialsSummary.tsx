import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon } from '@/components/ui';
import type { MaterialsSummary as Summary } from '@/models/material.model';
import { colors, spacing } from '@/theme';

export interface MaterialsSummaryProps {
  summary: Summary;
}

/** Cabecera con el número de materiales y los totales por unidad. Sin materiales no se muestra. */
export function MaterialsSummary({ summary }: MaterialsSummaryProps) {
  if (summary.count === 0) return null;

  return (
    <Card testID="materials-summary">
      <View
        style={styles.row}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`${summary.countLabel}${
          summary.customLabel ? `, ${summary.customLabel}` : ''
        }. Totales: ${summary.totalsLabel}`}
      >
        <Icon name="inventory-2" size={28} color={colors.secondaryDark} />
        <View style={styles.texts}>
          <AppText variant="titleMedium">{summary.countLabel}</AppText>
          {summary.customLabel ? (
            <AppText variant="bodySmall" color={colors.textSecondary}>
              {`Incluye ${summary.customLabel} (fuera del catálogo)`}
            </AppText>
          ) : null}
          <AppText variant="bodyMedium" color={colors.textSecondary}>
            {summary.totalsLabel}
          </AppText>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  texts: {
    flex: 1,
    gap: spacing.xs,
  },
});
