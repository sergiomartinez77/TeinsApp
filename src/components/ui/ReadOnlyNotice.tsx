import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface ReadOnlyNoticeProps {
  /** Por ejemplo: "La visita está cerrada: los materiales son de solo lectura." */
  message: string;
  /**
   * `card`: recuadro con borde, dentro del contenido (por defecto).
   * `bar`: franja a todo el ancho bajo la barra superior (anotaciones).
   */
  variant?: 'card' | 'bar';
  style?: StyleProp<ViewStyle>;
}

/** Aviso de que la visita está cerrada y su contenido ya no se puede editar. */
export function ReadOnlyNotice({ message, variant = 'card', style }: ReadOnlyNoticeProps) {
  const bar = variant === 'bar';
  return (
    <View
      style={[bar ? styles.bar : styles.card, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={message}
      testID="read-only-notice"
    >
      <Icon name="lock" size={bar ? 20 : 24} color={colors.info} />
      <AppText variant={bar ? 'bodyMedium' : 'titleSmall'} color={colors.info} style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    borderColor: colors.info,
    backgroundColor: colors.infoLight,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.infoLight,
  },
  text: {
    flex: 1,
  },
});
