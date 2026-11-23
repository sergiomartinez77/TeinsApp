import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Dialog, ErrorMessage, Input } from '@/components/ui';
import type { MaterialStockItem, StockMovementKind } from '@/models/inventory.model';
import { spacing } from '@/theme';

import {
  STOCK_NOTE_MAX_LENGTH,
  stockMovementSchema,
  type StockMovementFormValues,
  type StockMovementInput,
} from '../validation';

export interface StockMovementDialogProps {
  item: MaterialStockItem;
  kind: StockMovementKind;
  onDismiss: () => void;
  onSubmit: (input: StockMovementInput) => void;
  isSubmitting: boolean;
  /** Error al guardar, ya en español. */
  error?: string | null;
}

const TEXTS: Record<
  StockMovementKind,
  { title: string; submit: string; helper: string; notePlaceholder: string }
> = {
  purchase: {
    title: 'Registrar compra',
    submit: 'Registrar compra',
    helper: 'Cantidad que entra a la bodega.',
    notePlaceholder: 'Ej.: factura 001-123, proveedor',
  },
  adjustment: {
    title: 'Ajuste de inventario',
    submit: 'Guardar ajuste',
    helper: 'Positivo suma y negativo descuenta (p. ej. −3 por pérdida o conteo físico).',
    notePlaceholder: 'Motivo del ajuste',
  },
};

/** Formulario de compra o ajuste de bodega (admin/oficina). */
export function StockMovementDialog({
  item,
  kind,
  onDismiss,
  onSubmit,
  isSubmitting,
  error,
}: StockMovementDialogProps) {
  const texts = TEXTS[kind];
  const { control, handleSubmit } = useForm<StockMovementFormValues, unknown, StockMovementInput>({
    resolver: zodResolver(stockMovementSchema),
    defaultValues: { kind, quantity: '', note: '' },
  });
  const submit = handleSubmit(onSubmit);

  return (
    <Dialog
      visible
      title={texts.title}
      onDismiss={onDismiss}
      dismissable={!isSubmitting}
      testID="stock-movement-dialog"
      actions={
        <>
          <Button label="Cancelar" variant="text" onPress={onDismiss} disabled={isSubmitting} />
          <Button
            label={texts.submit}
            onPress={() => void submit()}
            loading={isSubmitting}
            fullWidth={false}
          />
        </>
      }
    >
      <View style={styles.material}>
        <AppText variant="labelMedium">{item.code}</AppText>
        <AppText variant="titleMedium">{item.name}</AppText>
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
            helperText={texts.helper}
            keyboardType={kind === 'adjustment' ? 'numbers-and-punctuation' : 'decimal-pad'}
            suffix={item.unit}
            editable={!isSubmitting}
          />
        )}
      />

      <Controller
        control={control}
        name="note"
        render={({ field, fieldState }) => (
          <Input
            label="Nota"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            placeholder={texts.notePlaceholder}
            multiline
            maxLength={STOCK_NOTE_MAX_LENGTH}
            editable={!isSubmitting}
          />
        )}
      />

      <AppText variant="bodySmall">
        Las existencias se actualizan cuando el servidor recibe el movimiento (al sincronizar).
      </AppText>

      {error ? <ErrorMessage message={error} /> : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  material: {
    gap: spacing.xs,
  },
});
