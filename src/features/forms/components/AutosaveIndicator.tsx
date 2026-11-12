import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { colors, spacing } from '@/theme';

import type { AutosaveStatus } from '../hooks/useAutosave';

export const AUTOSAVE_LABELS = {
  saving: 'Guardando...',
  saved: '✓ Guardado',
  error: 'Error al guardar',
} as const;

export interface AutosaveIndicatorProps {
  status: AutosaveStatus;
  /** Color del texto; por defecto blanco, para la barra superior. */
  color?: string;
}

/** Estado del autoguardado: "Guardando..." / "✓ Guardado" / "Error al guardar". */
export function AutosaveIndicator({ status, color = colors.onPrimary }: AutosaveIndicatorProps) {
  if (status === 'idle') return null;
  const label = AUTOSAVE_LABELS[status];

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      testID="autosave-indicator"
    >
      {status === 'saving' ? <ActivityIndicator size="small" color={color} /> : null}
      {status === 'error' ? <Icon name="error-outline" size={16} color={color} /> : null}
      <AppText variant="labelMedium" color={color} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
});
