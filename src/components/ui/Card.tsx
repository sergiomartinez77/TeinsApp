import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

export interface CardProps {
  children: ReactNode;
  /** Si se indica, la tarjeta completa es pulsable. */
  onPress?: () => void;
  onLongPress?: () => void;
  /** Quita el padding interno (para contenido a sangre, como imágenes). */
  noPadding?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Tarjeta TEINS: fondo blanco, borde gris, radio 12dp, sin sombra. */
export function Card({
  children,
  onPress,
  onLongPress,
  noPadding = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: CardProps) {
  const cardStyle = [styles.card, !noPadding && styles.padded, style];

  if (!onPress && !onLongPress) {
    return (
      <View style={cardStyle} testID={testID} accessibilityLabel={accessibilityLabel}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [cardStyle, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    minHeight: spacing.minTouchTarget,
  },
  padded: {
    padding: spacing.cardPadding,
  },
  pressed: {
    backgroundColor: colors.surfaceVariant,
  },
});
