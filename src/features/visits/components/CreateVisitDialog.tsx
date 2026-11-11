import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Dialog, Icon, Input, Select } from '@/components/ui';
import { VISIT_TYPE_LABELS, VISIT_TYPES } from '@/models/visit.model';
import { colors, radius, spacing } from '@/theme';

import {
  createVisitSchema,
  type CreateVisitFormValues,
  type CreateVisitInput,
} from '../validation';

const TYPE_OPTIONS = VISIT_TYPES.map((type) => ({ value: type, label: VISIT_TYPE_LABELS[type] }));

const DEFAULT_VALUES: CreateVisitFormValues = {
  title: '',
  visitType: 'general',
  address: '',
  description: '',
};

export interface CreateVisitDialogProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: CreateVisitInput) => void;
  isSubmitting: boolean;
  /** Error al guardar, ya en español. */
  error?: string | null;
}

/** Diálogo "Nueva visita": título y tipo obligatorios; dirección y descripción opcionales. */
export function CreateVisitDialog({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  error,
}: CreateVisitDialogProps) {
  const { control, handleSubmit, reset } = useForm<
    CreateVisitFormValues,
    unknown,
    CreateVisitInput
  >({
    resolver: zodResolver(createVisitSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const close = () => {
    reset(DEFAULT_VALUES);
    onDismiss();
  };
  const submit = handleSubmit(onSubmit);

  return (
    <Dialog
      visible={visible}
      title="Nueva visita"
      onDismiss={close}
      dismissable={!isSubmitting}
      testID="create-visit-dialog"
      actions={
        <>
          <Button label="Cancelar" variant="text" onPress={close} disabled={isSubmitting} />
          <Button
            label="Crear visita"
            onPress={() => void submit()}
            loading={isSubmitting}
            fullWidth={false}
          />
        </>
      }
    >
      <Controller
        control={control}
        name="title"
        render={({ field, fieldState }) => (
          <Input
            label="Título"
            required
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            placeholder="Ej.: Inspección tablero principal"
            autoCapitalize="sentences"
            maxLength={200}
            editable={!isSubmitting}
          />
        )}
      />

      <Controller
        control={control}
        name="visitType"
        render={({ field, fieldState }) => (
          <Select
            label="Tipo de visita"
            required
            options={TYPE_OPTIONS}
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
            disabled={isSubmitting}
          />
        )}
      />

      <Controller
        control={control}
        name="address"
        render={({ field, fieldState }) => (
          <Input
            label="Dirección"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            leftIcon="location-on"
            maxLength={300}
            editable={!isSubmitting}
          />
        )}
      />

      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <Input
            label="Descripción"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            multiline
            maxLength={2000}
            editable={!isSubmitting}
          />
        )}
      />

      {error ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Icon name="error-outline" size={20} color={colors.error} />
          <AppText variant="bodyMedium" color={colors.error} style={styles.errorText}>
            {error}
          </AppText>
        </View>
      ) : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.sm,
    backgroundColor: colors.errorLight,
  },
  errorText: {
    flex: 1,
  },
});
