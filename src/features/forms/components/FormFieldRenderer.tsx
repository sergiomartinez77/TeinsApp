import { Input, Select } from '@/components/ui';
import type { FormField } from '@/models/form.model';
import { scopedLogger } from '@/utils/logger';

import type { DraftValue } from '../services/form-schema';

import { BooleanField } from './BooleanField';
import { DateTimeField } from './DateTimeField';
import { MultiSelectField } from './MultiSelectField';

const log = scopedLogger('forms');

export interface FormFieldRendererProps {
  field: FormField;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
  error?: string;
  readOnly?: boolean;
}

const asText = (value: DraftValue): string => (typeof value === 'string' ? value : '');
const asList = (value: DraftValue): string[] => (Array.isArray(value) ? value : []);
const asBoolean = (value: DraftValue): boolean | null =>
  typeof value === 'boolean' ? value : null;

/** Dibuja el control adecuado para cada tipo de campo de la plantilla. */
export function FormFieldRenderer({
  field,
  value,
  onChange,
  error,
  readOnly = false,
}: FormFieldRendererProps) {
  const common = {
    label: field.label,
    required: field.required,
    error,
  };

  switch (field.type) {
    case 'boolean':
      return (
        <BooleanField
          {...common}
          hint={field.hint}
          value={asBoolean(value)}
          onChange={onChange}
          disabled={readOnly}
        />
      );
    case 'date':
    case 'time':
      return (
        <DateTimeField
          {...common}
          mode={field.type}
          hint={field.hint}
          value={asText(value)}
          onChange={onChange}
          disabled={readOnly}
        />
      );
    case 'select':
      return (
        <Select
          {...common}
          options={field.options.map((option) => ({ value: option, label: option }))}
          value={asText(value) || null}
          onChange={onChange}
          disabled={readOnly}
        />
      );
    case 'multiSelect':
      return (
        <MultiSelectField
          {...common}
          hint={field.hint}
          options={field.options}
          value={asList(value)}
          onChange={onChange}
          disabled={readOnly}
        />
      );
    case 'number':
    case 'decimal':
      return (
        <Input
          {...common}
          helperText={field.hint ?? undefined}
          value={asText(value)}
          onChangeText={onChange}
          keyboardType={field.type === 'number' ? 'number-pad' : 'decimal-pad'}
          suffix={field.unit ?? undefined}
          editable={!readOnly}
        />
      );
    case 'text':
    case 'textarea':
      return (
        <Input
          {...common}
          helperText={field.hint ?? undefined}
          value={asText(value)}
          onChangeText={onChange}
          multiline={field.type === 'textarea'}
          autoCapitalize="sentences"
          editable={!readOnly}
        />
      );
    default: {
      // Defensa ante datos inesperados: se muestra como texto sin romper la pantalla.
      log.warn('Tipo de campo no soportado; se muestra como texto', {
        fieldId: field.id,
        type: (field as { type: unknown }).type,
      });
      return (
        <Input {...common} value={asText(value)} onChangeText={onChange} editable={!readOnly} />
      );
    }
  }
}
