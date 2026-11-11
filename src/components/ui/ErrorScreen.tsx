import { StyleSheet, View } from 'react-native';

import { colors, maxContentWidth, spacing } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ErrorScreenProps {
  /** Mensaje en español, sin jerga técnica. */
  message: string;
  /** Si se indica, muestra el botón "Reintentar". */
  onRetry?: () => void;
}

/** Pantalla de error con icono, mensaje y reintento opcional. */
export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Icon name="error-outline" size={56} color={colors.error} />
      <AppText variant="bodyLarge" align="center" style={styles.message}>
        {message}
      </AppText>
      {onRetry ? (
        <Button
          label="Reintentar"
          icon="refresh"
          variant="outlined"
          onPress={onRetry}
          fullWidth={false}
          style={styles.retry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  message: {
    maxWidth: maxContentWidth,
  },
  retry: {
    alignSelf: 'center',
  },
});
