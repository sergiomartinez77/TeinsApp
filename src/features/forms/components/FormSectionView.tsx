import { Controller, type Control, type UseFormClearErrors } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import type { FormSection } from '@/models/form.model';
import { spacing } from '@/theme';

import type { FormDraft } from '../services/form-schema';

import { FormFieldRenderer } from './FormFieldRenderer';

export interface FormSectionViewProps {
  section: FormSection;
  control: Control<FormDraft, unknown, FormDraft>;
  clearErrors: UseFormClearErrors<FormDraft>;
  readOnly: boolean;
}

/** Campos de una sección conectados al estado del formulario. */
export function FormSectionView({ section, control, clearErrors, readOnly }: FormSectionViewProps) {
  return (
    <View style={styles.section}>
      <AppText variant="titleLarge" accessibilityRole="header">
        {section.title}
      </AppText>
      {section.fields.map((formField) => (
        <Controller
          key={formField.id}
          control={control}
          name={formField.id}
          render={({ field, fieldState }) => (
            <FormFieldRenderer
              field={formField}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                // El error se quita al corregir; la validación vuelve a correr al completar.
                if (fieldState.error) clearErrors(formField.id);
              }}
              error={fieldState.error?.message}
              readOnly={readOnly}
            />
          )}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
});
