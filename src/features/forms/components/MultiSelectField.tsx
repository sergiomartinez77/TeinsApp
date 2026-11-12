import { StyleSheet, View } from 'react-native';

import { Checkbox } from '@/components/ui';
import { colors, radius } from '@/theme';

import { accessibleName, FieldShell } from './FieldShell';

export interface MultiSelectFieldProps {
  label: string;
  options: readonly string[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  required?: boolean;
  error?: string;
  hint?: string | null;
  disabled?: boolean;
}

/** Selección múltiple: una casilla por opción. Conserva el orden de las opciones. */
export function MultiSelectField({
  label,
  options,
  value,
  onChange,
  required = false,
  error,
  hint,
  disabled = false,
}: MultiSelectFieldProps) {
  const toggle = (option: string, checked: boolean) => {
    const next = new Set(value);
    if (checked) next.add(option);
    else next.delete(option);
    onChange(options.filter((item) => next.has(item)));
  };

  return (
    <FieldShell label={label} required={required} error={error} hint={hint}>
      <View
        accessibilityLabel={accessibleName(label, required)}
        style={[styles.box, { borderColor: error ? colors.error : colors.border }]}
      >
        {options.map((option) => (
          <Checkbox
            key={option}
            label={option}
            checked={value.includes(option)}
            onChange={(checked) => toggle(option, checked)}
            disabled={disabled}
          />
        ))}
      </View>
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingVertical: 2,
  },
});
