import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import { AppText, Button, Dialog, ErrorMessage, Input } from '@/components/ui';
import type { MaterialStockItem } from '@/models/inventory.model';
import { formatQuantity } from '@/utils/number.utils';

import { minStockSchema, type MinStockFormValues, type MinStockInput } from '../validation';

export interface MinStockDialogProps {
  item: MaterialStockItem;
  onDismiss: () => void;
  onSubmit: (input: MinStockInput) => void;
  isSubmitting: boolean;
  /** Error al guardar, ya en español. */
  error?: string | null;
}

/** Cambia el mínimo de bodega de un material (solo admin). Vacío = sin mínimo. */
export function MinStockDialog({
  item,
  onDismiss,
  onSubmit,
  isSubmitting,
  error,
}: MinStockDialogProps) {
  const { control, handleSubmit } = useForm<MinStockFormValues, unknown, MinStockInput>({
    resolver: zodResolver(minStockSchema),
    defaultValues: { minStock: item.minStock === null ? '' : formatQuantity(item.minStock) },
  });
  const submit = handleSubmit(onSubmit);

  return (
    <Dialog
      visible
      title="Mínimo de bodega"
      onDismiss={onDismiss}
      dismissable={!isSubmitting}
      testID="min-stock-dialog"
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
      <AppText variant="titleMedium">{item.name}</AppText>
      <Controller
        control={control}
        name="minStock"
        render={({ field, fieldState }) => (
          <Input
            label="Mínimo"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            helperText="Por debajo de este valor el material aparece en “Qué comprar”. Déjalo vacío para no avisar."
            keyboardType="decimal-pad"
            suffix={item.unit}
            editable={!isSubmitting}
          />
        )}
      />
      {error ? <ErrorMessage message={error} /> : null}
    </Dialog>
  );
}
