import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { Icon, type IconName } from './Icon';

export interface IconButtonProps {
  icon: IconName;
  /** Obligatorio: un botón de solo icono necesita nombre para lectores de pantalla. */
  accessibilityLabel: string;
  onPress: () => void;
  color?: string;
  size?: number;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Botón de solo icono con área táctil de 48dp. */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  color = colors.textPrimary,
  size = 24,
  disabled = false,
  testID,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: spacing.minTouchTarget,
    height: spacing.minTouchTarget,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.38,
  },
});
