import { useState } from 'react';

import { Button, Dialog, Input } from '@/components/ui';

import { TEXT_MAX_LENGTH } from '../constants';

export interface TextElementDialogProps {
  /** Texto confirmado, ya sin espacios sobrantes y con 120 caracteres como máximo. */
  onConfirm: (text: string) => void;
  onCancel: () => void;
}

/** Limpia el texto escrito: sin espacios en los extremos y con el máximo permitido. */
export function cleanElementText(value: string): string {
  return value.trim().slice(0, TEXT_MAX_LENGTH).trim();
}

/** Diálogo para escribir el texto que se coloca en el punto tocado. Vacío = cancelar. */
export function TextElementDialog({ onConfirm, onCancel }: TextElementDialogProps) {
  const [value, setValue] = useState('');

  const confirm = () => {
    const text = cleanElementText(value);
    if (text) onConfirm(text);
    else onCancel();
  };

  return (
    <Dialog
      visible
      title="Añadir texto"
      onDismiss={onCancel}
      testID="text-element-dialog"
      actions={
        <>
          <Button label="Cancelar" variant="text" onPress={onCancel} testID="text-element-cancel" />
          <Button
            label="Añadir"
            onPress={confirm}
            fullWidth={false}
            testID="text-element-confirm"
          />
        </>
      }
    >
      <Input
        label="Texto"
        value={value}
        onChangeText={setValue}
        maxLength={TEXT_MAX_LENGTH}
        helperText={`${value.length}/${TEXT_MAX_LENGTH} caracteres`}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={confirm}
        testID="text-element-input"
      />
    </Dialog>
  );
}
