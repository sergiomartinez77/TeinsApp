import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, withAlpha } from '@/theme';

import { Icon, type IconName } from './Icon';

export interface BadgeProps {
  label: string;
  /** Color del estado: texto, borde (40 %) y fondo (12 %). */
  color: string;
  /** Icono pequeño opcional delante del texto (badges de sincronización). */
  icon?: IconName;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Chip de estado. Base de los badges de estado de visita y de sincronización.
 * El estado se comunica con texto además de color (no depende solo del color).
 */
export function Badge({ label, color, icon, testID, style }: BadgeProps) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.badge,
        { backgroundColor: withAlpha(color, 0.12), borderColor: withAlpha(color, 0.4) },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={10} color={color} /> : null}
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
  },
});
