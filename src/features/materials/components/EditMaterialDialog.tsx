import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Dialog, ErrorMessage, Input } from '@/components/ui';
import type { VisitMaterial } from '@/models/material.model';
import { colors, spacing } from '@/theme';
import { formatQuantity } from '@/utils/number.utils';

import {
  materialEntrySchema,
  OBSERVATIONS_MAX_LENGTH,
  type MaterialEntryFormValues,
  type MaterialEntryInput,
} from '../validation';

export interface EditMaterialDialogProps {
  material: VisitMaterial;
  onDismiss: () => void;
  onSubmit: (input: MaterialEntryInput) => void;
  isSubmitting: boolean;
  /** Error al guardar, ya en español. */
  error?: string | null;
}

/** Diálogo para cambiar la cantidad y las observaciones de un material de la visita. */
export function EditMaterialDialog({
  material,
  onDismiss,
  onSubmit,
  isSubmitting,
  error,
}: EditMaterialDialogProps) {
  const { control, handleSubmit } = useForm<MaterialEntryFormValues, unknown, MaterialEntryInput>({
    resolver: zodResolver(materialEntrySchema),
    defaultValues: {
      quantity: formatQuantity(material.quantity),
      observations: material.observations ?? '',
    },
  });
  const submit = handleSubmit(onSubmit);

  return (
    <Dialog
      visible
      title="Editar material"
      onDismiss={onDismiss}
      dismissable={!isSubmitting}
      testID="edit-material-dialog"
      actions={
        <>
          <Button label="Cancelar" variant="text" onPress={onDismiss} disabled={isSubmitting} />
          <Button
            label="Guardar"
            onPress={() => void submit()}
            loading={isSubmitting}
            fullWidth={false}
          />
        </>
      }
    >
      <View style={styles.material}>
        {material.isCustom ? (
          <Badge label="Personalizado" color={colors.info} icon="edit-note" style={styles.badge} />
        ) : (
          <AppText variant="labelMedium">{material.materialCode}</AppText>
        )}
        <AppText variant="titleMedium">{material.materialName}</AppText>
      </View>

      <Controller
        control={control}
        name="quantity"
        render={({ field, fieldState }) => (
          <Input
            label="Cantidad"
            required
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            keyboardType="decimal-pad"
            suffix={material.unit}
            editable={!isSubmitting}
          />
        )}
      />

      <Controller
        control={control}
        name="observations"
        render={({ field, fieldState }) => (
          <Input
            label="Observaciones"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            multiline
            maxLength={OBSERVATIONS_MAX_LENGTH}
            editable={!isSubmitting}
          />
        )}
      />

      {error ? <ErrorMessage message={error} /> : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  material: {
    gap: spacing.xs,
  },
  badge: {
    alignSelf: 'flex-start',
  },
});
