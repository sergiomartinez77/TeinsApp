import { useState } from 'react';

import { Button, Dialog, Input } from '@/components/ui';
import { PLAN_NAME_MAX_LENGTH } from '@/models/annotation.model';

import { cleanName } from '../services/annotation.service';

export interface NameDialogProps {
  title: string;
  label: string;
  confirmLabel: string;
  initialValue?: string;
  placeholder?: string;
  /** Si es `true`, un nombre vacío no se acepta (el botón queda desactivado). */
  required?: boolean;
  /** Nombre ya limpio (sin espacios en los extremos, 60 caracteres como máximo). */
  onConfirm: (name: string) => void;
  onCancel: () => void;
  testID?: string;
}

/** Diálogo para escribir el nombre de un plano o de una figura. */
export function NameDialog({
  title,
  label,
  confirmLabel,
  initialValue = '',
  placeholder,
  required = false,
  onConfirm,
  onCancel,
  testID = 'name-dialog',
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const name = cleanName(value);
  const disabled = required && !name;

  const confirm = () => {
    if (!disabled) onConfirm(name);
  };

  return (
    <Dialog
      visible
      title={title}
      onDismiss={onCancel}
      testID={testID}
      actions={
        <>
          <Button label="Cancelar" variant="text" onPress={onCancel} testID={`${testID}-cancel`} />
          <Button
            label={confirmLabel}
            onPress={confirm}
            disabled={disabled}
            fullWidth={false}
            testID={`${testID}-confirm`}
          />
        </>
      }
    >
      <Input
        label={label}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        maxLength={PLAN_NAME_MAX_LENGTH}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={confirm}
        testID={`${testID}-input`}
      />
    </Dialog>
  );
}
