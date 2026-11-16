import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { colors, contentWidths, spacing } from '@/theme';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('ui');

export const APP_ERROR_MESSAGES = {
  title: 'Algo salió mal',
  detail:
    'La aplicación tuvo un problema inesperado. Los datos guardados en el dispositivo están a salvo y no se han perdido.',
  hint: 'Toca “Reintentar” para volver a cargar la pantalla.',
  retry: 'Reintentar',
} as const;

export interface AppErrorScreenProps {
  /** Error capturado; solo se registra en el log, nunca se muestra. */
  error: Error;
  /** Vuelve a mostrar la pantalla que falló. */
  retry: () => Promise<void> | void;
}

/**
 * Pantalla de error global (ErrorBoundary de Expo Router). Lleva su propio
 * proveedor de áreas seguras porque puede mostrarse aunque falle el layout raíz.
 */
export function AppErrorScreen(props: AppErrorScreenProps) {
  return (
    <SafeAreaProvider>
      <ErrorContent {...props} />
    </SafeAreaProvider>
  );
}

function ErrorContent({ error, retry }: AppErrorScreenProps) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    log.error('Error no controlado en la interfaz', error);
  }, [error]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.scroll,
        {
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          paddingLeft: insets.left + spacing.lg,
          paddingRight: insets.right + spacing.lg,
        },
      ]}
    >
      <View style={styles.content} accessibilityRole="alert">
        <Icon name="error-outline" size={64} color={colors.error} />
        <AppText variant="headlineSmall" align="center" accessibilityRole="header">
          {APP_ERROR_MESSAGES.title}
        </AppText>
        <AppText variant="bodyLarge" align="center">
          {APP_ERROR_MESSAGES.detail}
        </AppText>
        <AppText variant="bodyMedium" align="center" color={colors.textSecondary}>
          {APP_ERROR_MESSAGES.hint}
        </AppText>
        <Button
          label={APP_ERROR_MESSAGES.retry}
          icon="refresh"
          onPress={() => void Promise.resolve(retry()).catch(() => undefined)}
          testID="app-error-retry"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: contentWidths.narrow,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
});
