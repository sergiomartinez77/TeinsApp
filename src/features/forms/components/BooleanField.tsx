import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

import { accessibleName, FieldShell } from './FieldShell';

export interface BooleanFieldProps {
  label: string;
  /** `null` = sin responder. */
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  required?: boolean;
  error?: string;
  hint?: string | null;
  disabled?: boolean;
}

const CHOICES = [
  { value: true, label: 'Sí' },
  { value: false, label: 'No' },
] as const;

/**
 * Pregunta Sí / No con estado "sin responder".
 * No se usa un interruptor porque no distingue "no" de "sin responder".
 * Pulsar la opción elegida la desmarca.
 */
export function BooleanField({
  label,
  value,
  onChange,
  required = false,
  error,
  hint,
  disabled = false,
}: BooleanFieldProps) {
  return (
    <FieldShell label={label} required={required} error={error} hint={hint}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={accessibleName(label, required)}
        style={styles.row}
      >
        {CHOICES.map((choice) => {
          const selected = value === choice.value;
          return (
            <Pressable
              key={choice.label}
              onPress={() => onChange(selected ? null : choice.value)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={choice.label}
              accessibilityState={{ checked: selected, selected, disabled }}
              style={({ pressed }) => [
                styles.choice,
                { borderColor: error ? colors.error : selected ? colors.primary : colors.border },
                selected && styles.selected,
                disabled && !selected && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {selected ? <Icon name="check" size={20} color={colors.onPrimary} /> : null}
              <AppText
                variant="titleMedium"
                color={selected ? colors.onPrimary : colors.textPrimary}
              >
                {choice.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  choice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: spacing.minTouchTarget,
    borderWidth: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  selected: {
    backgroundColor: colors.primary,
  },
  disabled: {
    backgroundColor: colors.grey100,
  },
  pressed: {
    opacity: 0.75,
  },
});
