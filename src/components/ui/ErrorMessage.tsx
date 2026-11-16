import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface ErrorMessageProps {
  /** Mensaje en español, sin jerga técnica. */
  message: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Recuadro rojo con un error dentro de una pantalla, un formulario o un
 * diálogo (p. ej. "no se pudo guardar"). Se anuncia a los lectores de pantalla.
 */
export function ErrorMessage({ message, testID, style }: ErrorMessageProps) {
  return (
    <View
      style={[styles.box, style]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Icon name="error-outline" size={20} color={colors.error} />
      <AppText variant="bodyMedium" color={colors.error} style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm + spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.errorLight,
  },
  text: {
    flex: 1,
  },
});
