import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { formatLongDate, greeting } from '@/utils/date.utils';

export interface WelcomeHeaderProps {
  name: string;
  /** Momento actual; se puede fijar en los tests. */
  now?: Date;
}

/** Saludo según la hora, nombre del técnico y fecha de hoy. */
export function WelcomeHeader({ name, now = new Date() }: WelcomeHeaderProps) {
  const date = formatLongDate(now);

  return (
    <View style={styles.container}>
      <AppText variant="headlineSmall" accessibilityRole="header">
        {greeting(now)}
        {name ? `, ${name}` : ''}
      </AppText>
      <AppText variant="bodyMedium" color={colors.textSecondary}>
        {date.charAt(0).toUpperCase() + date.slice(1)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
});
