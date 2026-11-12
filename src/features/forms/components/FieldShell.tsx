import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, spacing } from '@/theme';

export interface FieldShellProps {
  label: string;
  required?: boolean;
  /** Mensaje de error; reemplaza a la ayuda. */
  error?: string;
  hint?: string | null;
  children: ReactNode;
}

/** Etiqueta, control y mensaje de un campo que no es una caja de texto. */
export function FieldShell({ label, required = false, error, hint, children }: FieldShellProps) {
  return (
    <View>
      <AppText variant="labelLarge" color={colors.textSecondary} style={styles.label}>
        {label}
        {required ? <AppText color={colors.error}> *</AppText> : null}
      </AppText>
      {children}
      {error ? (
        <AppText variant="bodySmall" color={colors.error} style={styles.message} role="alert">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="bodySmall" style={styles.message}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/** Nombre accesible con la marca de obligatorio, igual que `Input`. */
export function accessibleName(label: string, required: boolean): string {
  return required ? `${label}, obligatorio` : label;
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.xs,
  },
  message: {
    marginTop: spacing.xs,
  },
});
