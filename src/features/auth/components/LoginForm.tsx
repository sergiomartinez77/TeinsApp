import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, type ComponentRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View, type TextInput } from 'react-native';

import { AppText, Button, Icon, Input } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

import { loginSchema, type LoginFormValues } from '../validation';

export interface LoginFormProps {
  onSubmit: (values: LoginFormValues) => void;
  onDemo: () => void;
  isSubmitting: boolean;
  /** Error devuelto por el servidor, ya en español. */
  error: string | null;
  /** Se llama cuando el usuario edita un campo, para limpiar el error anterior. */
  onEdit?: () => void;
}

export function LoginForm({ onSubmit, onDemo, isSubmitting, error, onEdit }: LoginFormProps) {
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const { control, handleSubmit } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit(onSubmit);

  return (
    <View style={styles.form}>
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            label="Correo electrónico"
            value={field.value}
            onChangeText={(value) => {
              field.onChange(value);
              onEdit?.();
            }}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            leftIcon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            returnKeyType="next"
            editable={!isSubmitting}
            onSubmitEditing={() => passwordRef.current?.focus()}
            submitBehavior="submit"
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <Input
            ref={passwordRef}
            label="Contraseña"
            value={field.value}
            onChangeText={(value) => {
              field.onChange(value);
              onEdit?.();
            }}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            leftIcon="lock-outline"
            password
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="done"
            editable={!isSubmitting}
            onSubmitEditing={() => void submit()}
          />
        )}
      />

      {error ? (
        <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Icon name="error-outline" size={20} color={colors.error} />
          <AppText variant="bodyMedium" color={colors.error} style={styles.errorText}>
            {error}
          </AppText>
        </View>
      ) : null}

      <Button
        label={isSubmitting ? 'Iniciando sesión...' : 'Iniciar sesión'}
        onPress={() => void submit()}
        loading={isSubmitting}
        testID="login-submit"
      />

      <Button
        label="Continuar en modo demo"
        variant="text"
        onPress={onDemo}
        disabled={isSubmitting}
        fullWidth
        accessibilityHint="Entra con datos de ejemplo, sin cuenta y sin sincronizar"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.sm,
    backgroundColor: colors.errorLight,
  },
  errorText: {
    flex: 1,
  },
});
