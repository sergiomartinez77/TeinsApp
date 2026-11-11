import { useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string = string> {
  label: string;
  options: readonly SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Selección única: campo que abre una lista de opciones en un diálogo. */
export function Select<T extends string = string>({
  label,
  options,
  value,
  onChange,
  placeholder = 'Selecciona una opción',
  error,
  required = false,
  disabled = false,
  containerStyle,
  testID,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={containerStyle}>
      <AppText variant="labelLarge" color={colors.textSecondary} style={styles.label}>
        {label}
        {required ? <AppText color={colors.error}> *</AppText> : null}
      </AppText>

      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="combobox"
        accessibilityLabel={required ? `${label}, obligatorio` : label}
        accessibilityValue={{ text: selected?.label ?? 'Sin seleccionar' }}
        accessibilityHint={error}
        accessibilityState={{ disabled, expanded: open }}
        testID={testID}
        style={[
          styles.field,
          { borderColor: error ? colors.error : colors.border },
          disabled && styles.disabled,
        ]}
      >
        <AppText
          variant="bodyLarge"
          color={selected ? colors.textPrimary : colors.textDisabled}
          numberOfLines={1}
          style={styles.value}
        >
          {selected?.label ?? placeholder}
        </AppText>
        <Icon name="arrow-drop-down" size={24} color={colors.textSecondary} />
      </Pressable>

      {error ? (
        <AppText variant="bodySmall" color={colors.error} style={styles.message} role="alert">
          {error}
        </AppText>
      ) : null}

      <Dialog
        visible={open}
        title={label}
        onDismiss={() => setOpen(false)}
        actions={<Button label="Cancelar" variant="text" onPress={() => setOpen(false)} />}
      >
        <View accessibilityRole="radiogroup">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: isSelected, checked: isSelected }}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              >
                <Icon
                  name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                  size={22}
                  color={isSelected ? colors.primary : colors.grey500}
                />
                <AppText variant="bodyLarge" style={styles.optionLabel}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.xs,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: spacing.minTouchTarget,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  disabled: {
    backgroundColor: colors.grey100,
  },
  value: {
    flex: 1,
  },
  message: {
    marginTop: spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: spacing.minTouchTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  optionPressed: {
    backgroundColor: colors.surfaceVariant,
  },
  optionLabel: {
    flex: 1,
  },
});
