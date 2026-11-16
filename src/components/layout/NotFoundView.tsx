import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { colors, contentWidths, spacing } from '@/theme';

export const NOT_FOUND_MESSAGES = {
  title: 'Pantalla no encontrada',
  detail: 'La pantalla que buscas no existe o ya no está disponible.',
  goHome: 'Volver al inicio',
} as const;

export interface NotFoundViewProps {
  onGoHome: () => void;
}

/** Contenido de la ruta no encontrada (`+not-found`). */
export function NotFoundView({ onGoHome }: NotFoundViewProps) {
  const insets = useSafeAreaInsets();

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
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Icon name="search-off" size={64} color={colors.grey400} />
        <AppText variant="headlineSmall" align="center" accessibilityRole="header">
          {NOT_FOUND_MESSAGES.title}
        </AppText>
        <AppText variant="bodyLarge" align="center" color={colors.textSecondary}>
          {NOT_FOUND_MESSAGES.detail}
        </AppText>
        <Button
          label={NOT_FOUND_MESSAGES.goHome}
          icon="home"
          onPress={onGoHome}
          testID="not-found-home"
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
