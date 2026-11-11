import { useState, type ComponentProps } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Mensaje de error en español; si existe, el campo se muestra en rojo. */
  error?: string;
  /** Texto de ayuda bajo el campo (se oculta si hay error). */
  helperText?: string;
  /** Marca visual de campo obligatorio. */
  required?: boolean;
  /** Campo de contraseña con botón para mostrar/ocultar. */
  password?: boolean;
  leftIcon?: IconName;
  /** Texto fijo a la derecha, p. ej. la unidad de medida ("m", "V"). */
  suffix?: string;
  ref?: ComponentProps<typeof TextInput>['ref'];
  containerStyle?: StyleProp<ViewStyle>;
}

/** Campo de texto TEINS: fondo blanco, borde gris, foco azul de 2dp. */
export function Input({
  label,
  error,
  helperText,
  required = false,
  password = false,
  leftIcon,
  suffix,
  ref,
  containerStyle,
  editable = true,
  multiline = false,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(password);

  const borderColor = error ? colors.error : focused ? colors.borderFocus : colors.border;

  return (
    <View style={containerStyle}>
      <AppText variant="labelLarge" color={colors.textSecondary} style={styles.label}>
        {label}
        {required ? <AppText color={colors.error}> *</AppText> : null}
      </AppText>

      <View
        style={[
          styles.field,
          { borderColor, borderWidth: focused ? 2 : 1 },
          // Compensa el borde más grueso para que el contenido no "salte" al enfocar.
          { paddingHorizontal: spacing.md - (focused ? 1 : 0) },
          multiline && styles.multilineField,
          !editable && styles.disabledField,
        ]}
      >
        {leftIcon ? <Icon name={leftIcon} size={20} color={colors.textSecondary} /> : null}

        <TextInput
          ref={ref}
          style={[styles.input, multiline && styles.multilineInput]}
          placeholderTextColor={colors.textDisabled}
          selectionColor={colors.primary}
          editable={editable}
          multiline={multiline}
          secureTextEntry={hidden}
          autoCapitalize={password ? 'none' : rest.autoCapitalize}
          autoCorrect={password ? false : rest.autoCorrect}
          accessibilityLabel={required ? `${label}, obligatorio` : label}
          accessibilityHint={error ?? helperText}
          aria-invalid={Boolean(error)}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />

        {suffix ? (
          <AppText variant="bodyMedium" color={colors.textSecondary}>
            {suffix}
          </AppText>
        ) : null}

        {password ? (
          <Pressable
            onPress={() => setHidden((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar contraseña' : 'Ocultar contraseña'}
            hitSlop={12}
            style={styles.toggle}
          >
            <Icon
              name={hidden ? 'visibility' : 'visibility-off'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <AppText variant="bodySmall" color={colors.error} style={styles.message} role="alert">
          {error}
        </AppText>
      ) : helperText ? (
        <AppText variant="bodySmall" style={styles.message}>
          {helperText}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.xs,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.minTouchTarget,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  multilineField: {
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  disabledField: {
    backgroundColor: colors.grey100,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm + 4,
  },
  multilineInput: {
    minHeight: 96,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  toggle: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    marginTop: spacing.xs,
  },
});
