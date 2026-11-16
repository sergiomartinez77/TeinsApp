import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { colors, contentWidths, radius, spacing } from '@/theme';

export interface SplashViewProps {
  /** Variables de configuración que faltan; vacío si todo está bien. */
  missingConfig?: readonly string[];
}

/** Pantalla de arranque: marca TEINS e indicador de carga (o aviso de configuración). */
export function SplashView({ missingConfig = [] }: SplashViewProps) {
  return (
    <View style={styles.container}>
      <View style={styles.logo}>
        <Icon name="engineering" size={48} color={colors.primary} />
      </View>
      <AppText
        variant="displaySmall"
        color={colors.onPrimary}
        accessibilityRole="header"
        style={styles.title}
      >
        TEINS
      </AppText>
      <AppText variant="bodyLarge" color={colors.onPrimary}>
        Visitas Técnicas
      </AppText>

      {missingConfig.length === 0 ? (
        <ActivityIndicator
          color={colors.onPrimary}
          size="large"
          style={styles.spinner}
          accessibilityLabel="Cargando"
        />
      ) : (
        <View style={styles.errorBox} accessibilityRole="alert">
          <AppText variant="titleMedium" color={colors.error}>
            Falta configurar la aplicación
          </AppText>
          <AppText variant="bodyMedium">
            Faltan estos datos de configuración: {missingConfig.join(', ')}. Pide ayuda al
            administrador del sistema.
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.primary,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  title: {
    fontWeight: '700',
    letterSpacing: 3,
  },
  spinner: {
    marginTop: spacing.lg,
  },
  errorBox: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorLight,
    maxWidth: contentWidths.narrow,
  },
});
