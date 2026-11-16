import { StyleSheet, View } from 'react-native';

import { colors, contentWidths, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon: IconName;
  message: string;
  /** Texto secundario, p. ej. la instrucción para crear el primer elemento. */
  hint?: string;
}

/**
 * Estado de lista vacía. No incluye acciones: la creación la gestiona
 * el botón flotante de la pantalla que lo contiene.
 */
export function EmptyState({ icon, message, hint }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Icon name={icon} size={64} color={colors.grey400} />
      <AppText variant="titleMedium" color={colors.textSecondary} align="center">
        {message}
      </AppText>
      {hint ? (
        <AppText variant="bodyMedium" color={colors.textSecondary} align="center">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    maxWidth: contentWidths.narrow,
  },
});
