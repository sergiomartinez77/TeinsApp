import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

/** Casilla con texto; toda la fila es pulsable (48dp de alto como mínimo). */
export function Checkbox({ label, checked, onChange, disabled = false, testID }: CheckboxProps) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon
        name={checked ? 'check-box' : 'check-box-outline-blank'}
        size={24}
        color={disabled ? colors.grey400 : checked ? colors.primary : colors.grey600}
      />
      <AppText
        variant="bodyLarge"
        color={disabled ? colors.textSecondary : colors.textPrimary}
        style={styles.label}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: spacing.minTouchTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  pressed: {
    backgroundColor: colors.surfaceVariant,
  },
  label: {
    flex: 1,
  },
});
