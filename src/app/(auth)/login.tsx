import { StatusBar } from 'expo-status-bar';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Icon } from '@/components/ui';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { useAuthStore } from '@/store/auth.store';
import { colors, maxContentWidth, radius, spacing } from '@/theme';

/** Ruta `/login`. En tablet el formulario queda centrado con ancho máximo de 480dp. */
export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const isSubmitting = useAuthStore((state) => state.isSubmitting);
  const error = useAuthStore((state) => state.error);
  const signIn = useAuthStore((state) => state.signIn);
  const enterDemoMode = useAuthStore((state) => state.enterDemoMode);
  const clearError = useAuthStore((state) => state.clearError);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            paddingLeft: insets.left + spacing.lg,
            paddingRight: insets.right + spacing.lg,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.logo}>
              <Icon name="engineering" size={44} color={colors.onPrimary} />
            </View>
            <AppText variant="headlineLarge" accessibilityRole="header" style={styles.title}>
              TEINS
            </AppText>
            <AppText variant="bodyLarge" color={colors.textSecondary}>
              Visitas Técnicas
            </AppText>
          </View>

          <LoginForm
            onSubmit={({ email, password }) => void signIn(email, password)}
            onDemo={enterDemoMode}
            isSubmitting={isSubmitting}
            error={error}
            onEdit={error ? clearError : undefined}
          />

          <AppText variant="bodySmall" align="center" style={styles.footer}>
            © {new Date().getFullYear()} TEINS. Todos los derechos reservados.
          </AppText>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    gap: spacing.xl,
  },
  header: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginBottom: spacing.sm,
  },
  title: {
    letterSpacing: 3,
  },
  footer: {
    marginTop: spacing.sm,
  },
});
