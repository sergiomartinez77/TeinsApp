import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { Icon, type IconName } from './Icon';

/** Espacio bajo una lista para que un botón flotante no tape su último elemento. */
export const FAB_CLEARANCE = 96;

export interface FabProps {
  icon: IconName;
  onPress: () => void;
  /** Texto junto al icono (botón extendido). */
  label?: string;
  /** Obligatorio si no hay `label`. */
  accessibilityLabel?: string;
  /** `small`: botón secundario de 48dp; por defecto 56dp. */
  size?: 'regular' | 'small';
  backgroundColor?: string;
  color?: string;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Botón flotante de acción principal. Quien lo usa decide su posición. */
export function Fab({
  icon,
  onPress,
  label,
  accessibilityLabel,
  size = 'regular',
  backgroundColor = colors.primary,
  color = colors.onPrimary,
  disabled = false,
  testID,
  style,
}: FabProps) {
  const dimension = size === 'small' ? spacing.minTouchTarget : 56;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor, minWidth: dimension, height: dimension },
        label ? styles.extended : null,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon name={icon} size={24} color={color} />
      {label ? <Text style={[styles.label, { color }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    elevation: 4,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  extended: {
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});
