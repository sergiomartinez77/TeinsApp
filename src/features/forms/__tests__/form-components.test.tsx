import { fireEvent, render, screen } from '@testing-library/react-native';

import type { FormField, FormFieldType } from '@/models/form.model';

import { AutosaveIndicator } from '../components/AutosaveIndicator';
import { BooleanField } from '../components/BooleanField';
import { FormFieldRenderer } from '../components/FormFieldRenderer';
import { SectionChips } from '../components/SectionChips';
import type { DraftValue } from '../services/form-schema';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const MockPicker = (props: { testID?: string }) => <View testID={props.testID} />;
  return { __esModule: true, default: MockPicker, DateTimePickerAndroid: { open: jest.fn() } };
});

const field = (type: FormFieldType, overrides: Partial<FormField> = {}): FormField => ({
  id: `campo_${type}`,
  type,
  label: 'Campo',
  required: false,
  hint: null,
  options: [],
  unit: null,
  ...overrides,
});

const renderField = (
  formField: FormField,
  value: DraftValue,
  extra: { error?: string; readOnly?: boolean } = {},
) => {
  const onChange = jest.fn();
  const view = render(
    <FormFieldRenderer field={formField} value={value} onChange={onChange} {...extra} />,
  );
  return { onChange, view };
};

describe('FormFieldRenderer', () => {
  it('texto: cambia el valor y marca el obligatorio', async () => {
    const { onChange, view } = renderField(field('text', { required: true }), '');
    await view;

    await fireEvent.changeText(screen.getByLabelText('Campo, obligatorio'), 'Hola');
    expect(onChange).toHaveBeenCalledWith('Hola');
  });

  it('texto largo: campo multilínea con la ayuda visible', async () => {
    const { view } = renderField(field('textarea', { hint: 'Describe el hallazgo' }), 'abc');
    await view;

    expect(screen.getByLabelText('Campo').props.multiline).toBe(true);
    expect(screen.getByText('Describe el hallazgo')).toBeOnTheScreen();
  });

  it('decimal: teclado decimal y unidad como sufijo', async () => {
    const { onChange, view } = renderField(field('decimal', { unit: 'V' }), '');
    await view;

    const input = screen.getByLabelText('Campo');
    expect(input.props.keyboardType).toBe('decimal-pad');
    expect(screen.getByText('V')).toBeOnTheScreen();
    await fireEvent.changeText(input, '220,5');
    expect(onChange).toHaveBeenCalledWith('220,5');
  });

  it('número: teclado numérico', async () => {
    const { view } = renderField(field('number'), '3');
    await view;

    expect(screen.getByLabelText('Campo').props.keyboardType).toBe('number-pad');
  });

  it('muestra el error bajo el campo', async () => {
    const { view } = renderField(field('number'), 'abc', { error: 'Ingresa un número válido.' });
    await view;

    expect(screen.getByText('Ingresa un número válido.')).toBeOnTheScreen();
  });

  it('solo lectura: el texto no se puede editar', async () => {
    const { view } = renderField(field('text'), 'fijo', { readOnly: true });
    await view;

    expect(screen.getByLabelText('Campo').props.editable).toBe(false);
  });

  it('sí/no: elige una respuesta', async () => {
    const { onChange, view } = renderField(field('boolean'), null);
    await view;

    await fireEvent.press(screen.getByRole('radio', { name: 'Sí' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('selección: abre la lista y elige una opción', async () => {
    const { onChange, view } = renderField(
      field('select', { required: true, options: ['Bueno', 'Malo'] }),
      '',
    );
    await view;

    await fireEvent.press(screen.getByRole('combobox', { name: 'Campo, obligatorio' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Malo' }));
    expect(onChange).toHaveBeenCalledWith('Malo');
  });

  it('selección múltiple: marca y desmarca conservando el orden de las opciones', async () => {
    const { onChange, view } = renderField(
      field('multiSelect', { options: ['CCTV', 'UPS', 'Alarma'] }),
      ['Alarma'],
    );
    await view;

    expect(screen.getByRole('checkbox', { name: 'Alarma' })).toBeChecked();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'CCTV' }));
    expect(onChange).toHaveBeenLastCalledWith(['CCTV', 'Alarma']);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Alarma' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('selección múltiple en solo lectura no cambia', async () => {
    const { onChange, view } = renderField(field('multiSelect', { options: ['UPS'] }), [], {
      readOnly: true,
    });
    await view;

    await fireEvent.press(screen.getByRole('checkbox', { name: 'UPS' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fecha: muestra el valor en español y permite borrarlo', async () => {
    const { onChange, view } = renderField(field('date'), '2026-11-11');
    await view;

    expect(screen.getByText('miércoles, 11 de noviembre de 2026')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar Campo' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('hora: abre el selector y guarda HH:mm al aceptar', async () => {
    const { onChange, view } = renderField(field('time'), '08:30');
    await view;

    expect(screen.getByText('08:30')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Campo' }));
    expect(await screen.findByTestId('date-time-picker')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onChange).toHaveBeenCalledWith('08:30');
  });

  it('fecha vacía en solo lectura: sin botón de borrar y sin abrir el selector', async () => {
    const { view } = renderField(field('date'), '', { readOnly: true });
    await view;

    expect(screen.getByText('Selecciona una fecha')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Borrar Campo' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Campo' }));
    expect(screen.queryByTestId('date-time-picker')).toBeNull();
  });
});

describe('BooleanField', () => {
  const setup = (value: boolean | null, extra: { disabled?: boolean; error?: string } = {}) => {
    const onChange = jest.fn();
    return {
      onChange,
      view: render(
        <BooleanField label="¿Funciona?" required value={value} onChange={onChange} {...extra} />,
      ),
    };
  };

  it('distingue "no" de "sin responder"', async () => {
    const { view } = setup(null);
    await view;

    expect(screen.getByRole('radio', { name: 'Sí' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
  });

  it('marca la respuesta elegida y la desmarca al volver a pulsarla', async () => {
    const { onChange, view } = setup(false);
    await view;

    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'No' }));
    expect(onChange).toHaveBeenCalledWith(null);
    await fireEvent.press(screen.getByRole('radio', { name: 'Sí' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('muestra el error y no cambia si está deshabilitado', async () => {
    const { onChange, view } = setup(null, {
      disabled: true,
      error: 'Este campo es obligatorio.',
    });
    await view;

    expect(screen.getByText('Este campo es obligatorio.')).toBeOnTheScreen();
    expect(screen.getByLabelText('¿Funciona?, obligatorio')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Sí' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('AutosaveIndicator', () => {
  it.each([
    ['saving', 'Guardando...'],
    ['saved', '✓ Guardado'],
    ['error', 'Error al guardar'],
  ] as const)('estado %s → "%s"', async (status, label) => {
    await render(<AutosaveIndicator status={status} />);

    expect(screen.getByText(label)).toBeOnTheScreen();
  });

  it('no muestra nada antes del primer guardado', async () => {
    await render(<AutosaveIndicator status="idle" />);

    expect(screen.queryByTestId('autosave-indicator')).toBeNull();
  });
});

describe('SectionChips', () => {
  const sections = [
    { id: 'a', title: 'Datos' },
    { id: 'b', title: 'Equipo' },
    { id: 'c', title: 'Cierre' },
  ];

  it('marca la sección activa y avisa al elegir otra', async () => {
    const onSelect = jest.fn();
    await render(<SectionChips sections={sections} activeIndex={0} onSelect={onSelect} />);

    expect(screen.getByRole('tab', { name: 'Datos' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Equipo' })).not.toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: 'Cierre' }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('indica las secciones con campos por corregir', async () => {
    await render(
      <SectionChips
        sections={sections}
        activeIndex={0}
        errorSectionIds={['b']}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Equipo, con campos por corregir' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Datos' })).toBeOnTheScreen();
  });
});
