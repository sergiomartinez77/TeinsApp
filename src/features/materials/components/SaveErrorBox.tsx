import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

/** Error al guardar, mostrado dentro del diálogo o de la hoja. */
export function SaveErrorBox({ message }: { message: string }) {
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Icon name="error-outline" size={20} color={colors.error} />
      <AppText variant="bodyMedium" color={colors.error} style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.sm,
    backgroundColor: colors.errorLight,
  },
  text: {
    flex: 1,
  },
});
