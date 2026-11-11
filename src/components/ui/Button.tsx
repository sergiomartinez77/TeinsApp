import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'outlined' | 'text';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Color principal: fondo en `primary`, borde y texto en `outlined`/`text`. */
  color?: string;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Ocupa todo el ancho disponible. Por defecto sí, salvo en la variante `text`. */
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Botón TEINS: altura mínima 48dp, radio 8dp. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  color = colors.primary,
  icon,
  loading = false,
  disabled = false,
  fullWidth = variant !== 'text',
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  const foreground =
    variant === 'primary' ? colors.onPrimary : inactive ? colors.textDisabled : color;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        fullWidth ? styles.fullWidth : styles.inline,
        variant === 'primary' && { backgroundColor: inactive ? colors.grey400 : color },
        variant === 'outlined' && {
          borderWidth: 1.5,
          borderColor: inactive ? colors.grey400 : color,
        },
        variant === 'text' && styles.textVariant,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={foreground} />
        ) : icon ? (
          <Icon name={icon} size={20} color={foreground} />
        ) : null}
        <Text
          style={[styles.label, variant === 'text' && styles.textLabel, { color: foreground }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: spacing.minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  inline: {
    alignSelf: 'flex-start',
  },
  textVariant: {
    paddingHorizontal: spacing.sm,
  },
  pressed: {
    opacity: 0.75,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  textLabel: {
    fontSize: 14,
  },
});
