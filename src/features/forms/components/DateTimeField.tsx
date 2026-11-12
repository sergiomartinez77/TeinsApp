import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Dialog, Icon, IconButton } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

import {
  formatDateValue,
  formatTimeValue,
  parseDateValue,
  parseTimeValue,
  toDateValue,
  toTimeValue,
} from '../services/field-format';

import { accessibleName, FieldShell } from './FieldShell';

export interface DateTimeFieldProps {
  mode: 'date' | 'time';
  label: string;
  /** `YYYY-MM-DD` (fecha) o `HH:mm` (hora); `''` = vacío. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
  hint?: string | null;
  disabled?: boolean;
}

const PLACEHOLDERS = { date: 'Selecciona una fecha', time: 'Selecciona una hora' } as const;

/**
 * Fecha u hora con el selector nativo. En Android se abre el diálogo del
 * sistema; en iOS, la rueda dentro de un diálogo con "Aceptar".
 */
export function DateTimeField({
  mode,
  label,
  value,
  onChange,
  required = false,
  error,
  hint,
  disabled = false,
}: DateTimeFieldProps) {
  const [draft, setDraft] = useState<Date | null>(null);

  const current = (mode === 'date' ? parseDateValue(value) : parseTimeValue(value)) ?? new Date();
  const toValue = mode === 'date' ? toDateValue : toTimeValue;
  const display = value ? (mode === 'date' ? formatDateValue(value) : formatTimeValue(value)) : '';

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode,
        is24Hour: true,
        onValueChange: (_event, date) => onChange(toValue(date)),
      });
    } else {
      setDraft(current);
    }
  };

  const accept = () => {
    if (draft) onChange(toValue(draft));
    setDraft(null);
  };

  return (
    <FieldShell label={label} required={required} error={error} hint={hint}>
      <View
        style={[
          styles.field,
          { borderColor: error ? colors.error : colors.border },
          disabled && styles.disabled,
        ]}
      >
        <Pressable
          onPress={open}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={accessibleName(label, required)}
          accessibilityValue={{ text: display || 'Sin seleccionar' }}
          accessibilityHint={error}
          accessibilityState={{ disabled }}
          style={styles.trigger}
        >
          <Icon
            name={mode === 'date' ? 'event' : 'schedule'}
            size={20}
            color={colors.textSecondary}
          />
          <AppText
            variant="bodyLarge"
            color={display ? colors.textPrimary : colors.textDisabled}
            numberOfLines={1}
            style={styles.value}
          >
            {display || PLACEHOLDERS[mode]}
          </AppText>
        </Pressable>
        {value && !disabled ? (
          <IconButton
            icon="close"
            accessibilityLabel={`Borrar ${label}`}
            color={colors.textSecondary}
            size={20}
            onPress={() => onChange('')}
          />
        ) : null}
      </View>

      {Platform.OS !== 'android' ? (
        <Dialog
          visible={draft !== null}
          title={label}
          onDismiss={() => setDraft(null)}
          actions={
            <>
              <Button label="Cancelar" variant="text" onPress={() => setDraft(null)} />
              <Button label="Aceptar" onPress={accept} fullWidth={false} />
            </>
          }
        >
          {draft ? (
            <DateTimePicker
              value={draft}
              mode={mode}
              display="spinner"
              locale="es-ES"
              themeVariant="light"
              textColor={colors.textPrimary}
              onValueChange={(_event, date) => setDraft(date)}
              testID="date-time-picker"
            />
          ) : null}
        </Dialog>
      ) : null}
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: spacing.minTouchTarget,
    borderWidth: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  disabled: {
    backgroundColor: colors.grey100,
  },
  trigger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  value: {
    flex: 1,
  },
});
