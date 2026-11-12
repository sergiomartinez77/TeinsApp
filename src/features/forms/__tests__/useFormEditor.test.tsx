import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Pressable, Text, View } from 'react-native';

import { TEMPLATE_KEY, templateFromAsset, type FormValues } from '@/models/form.model';

import { FormSectionView } from '../components/FormSectionView';
import { useFormEditor } from '../hooks/useFormEditor';
import type { FormResponseDatabase } from '../services/response.service';

import { createDb, visitRow, type Row } from './fake-form-db';

let mockDb: FormResponseDatabase | null = null;
jest.mock('@powersync/react', () => ({ usePowerSync: () => mockDb }));
jest.mock('@/utils/uuid.utils', () => ({ generateId: () => 'respuesta-1' }));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));

const template = (() => {
  const parsed = templateFromAsset({
    id: 'prueba_v1',
    name: 'Prueba',
    visit_type: 'general',
    version: 1,
    sections: [
      {
        id: 'datos',
        title: 'Datos',
        order: 0,
        fields: [{ id: 'nombre', type: 'text', label: 'Nombre', required: true }],
      },
      {
        id: 'equipo',
        title: 'Equipo',
        order: 1,
        fields: [{ id: 'cantidad', type: 'number', label: 'Cantidad', required: true }],
      },
    ],
  });
  if (!parsed) throw new Error('plantilla de prueba inválida');
  return parsed;
})();

interface HarnessProps {
  readOnly?: boolean;
  initialValues?: FormValues;
}

/** Pantalla mínima: la sección activa con sus campos reales y el botón de completar. */
function Harness({ readOnly = false, initialValues = {} }: HarnessProps) {
  const editor = useFormEditor({ visitId: 'v1', template, initialValues, readOnly });
  const section = template.sections[editor.sectionIndex];

  return (
    <View>
      <Text testID="estado">{editor.autosaveStatus}</Text>
      <Text testID="seccion">{section?.id}</Text>
      <Text testID="errores">{editor.errorSectionIds.join(',')}</Text>
      {section ? (
        <FormSectionView
          section={section}
          control={editor.control}
          clearErrors={editor.clearErrors}
          readOnly={readOnly}
        />
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => editor.setSectionIndex(1)}>
        <Text>Siguiente</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={editor.complete}>
        <Text>Completar</Text>
      </Pressable>
    </View>
  );
}

const renderHarness = (props: HarnessProps = {}) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
};

const responsesOf = (row: Row | undefined) => JSON.parse(String(row?.responses)) as Row;
const responseWrites = (statements: string[]) =>
  statements.filter((sql) => sql.includes('form_responses'));

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  mockDb = null;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useFormEditor (integración con el autoguardado)', () => {
  it('al editar un campo guarda una vez a los 800 ms con el valor escrito', async () => {
    const fake = createDb();
    mockDb = fake.db;
    await renderHarness();

    await fireEvent.changeText(screen.getByLabelText('Nombre, obligatorio'), 'Ana');
    await advance(799);
    expect(fake.rows.size).toBe(0);

    await advance(1);
    await waitFor(() => expect(fake.rows.size).toBe(1));
    expect(responsesOf(fake.rows.get('respuesta-1'))).toEqual({
      nombre: 'Ana',
      [TEMPLATE_KEY]: 'prueba_v1',
    });
    expect(responseWrites(fake.statements)).toHaveLength(1);
    expect(screen.getByTestId('estado')).toHaveTextContent('saved');
  });

  it('varios cambios seguidos producen un solo guardado con el último valor', async () => {
    const fake = createDb();
    mockDb = fake.db;
    await renderHarness();
    const input = screen.getByLabelText('Nombre, obligatorio');

    for (const text of ['A', 'An', 'Ana', 'Ana M']) {
      await fireEvent.changeText(input, text);
      await advance(300);
    }
    await advance(800);

    await waitFor(() => expect(fake.rows.size).toBe(1));
    expect(responseWrites(fake.statements)).toHaveLength(1);
    expect(responsesOf(fake.rows.get('respuesta-1'))).toMatchObject({ nombre: 'Ana M' });
  });

  it('al desmontar con cambios pendientes guarda de inmediato', async () => {
    const fake = createDb();
    mockDb = fake.db;
    const view = await renderHarness();

    await fireEvent.changeText(screen.getByLabelText('Nombre, obligatorio'), 'Pendiente');
    await view.unmount();

    await waitFor(() => expect(fake.rows.size).toBe(1));
    expect(responsesOf(fake.rows.get('respuesta-1'))).toMatchObject({ nombre: 'Pendiente' });
  });

  it('en solo lectura (respuesta completada) editar no guarda nada', async () => {
    const fake = createDb();
    mockDb = fake.db;
    const view = await renderHarness({ readOnly: true, initialValues: { nombre: 'Fijo' } });

    const input = screen.getByLabelText('Nombre, obligatorio');
    expect(input.props.editable).toBe(false);
    await fireEvent.changeText(input, 'Cambio');
    await fireEvent.press(screen.getByRole('button', { name: 'Completar' }));
    await advance(2000);
    await view.unmount();

    expect(fake.statements).toHaveLength(0);
    expect(screen.queryByTestId('estado')).toBeNull();
  });

  it('con la visita cerrada el guardado se rechaza sin escribir y avisa del error', async () => {
    const fake = createDb({ visits: [visitRow({ status: 'completed' })] });
    mockDb = fake.db;
    await renderHarness();

    await fireEvent.changeText(screen.getByLabelText('Nombre, obligatorio'), 'Ana');
    await advance(800);

    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('error'));
    expect(fake.statements).toHaveLength(0);
    expect(fake.rows.size).toBe(0);
  });

  it('completar con un obligatorio vacío no completa y salta a la sección con error', async () => {
    const fake = createDb();
    mockDb = fake.db;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderHarness();

    await fireEvent.changeText(screen.getByLabelText('Nombre, obligatorio'), 'Ana');
    await fireEvent.press(screen.getByRole('button', { name: 'Completar' }));

    await waitFor(() => expect(screen.getByTestId('seccion')).toHaveTextContent('equipo'));
    expect(screen.getByTestId('errores')).toHaveTextContent('equipo');
    expect(screen.getByText('Este campo es obligatorio.')).toBeOnTheScreen();
    expect(alert).not.toHaveBeenCalled();
    await advance(800);
    expect(fake.rows.get('respuesta-1')?.is_complete).toBe(0);
  });

  it('completar con todo válido, tras confirmar, deja is_complete = 1', async () => {
    const fake = createDb();
    mockDb = fake.db;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Completar')?.onPress?.();
    });
    await renderHarness();

    await fireEvent.changeText(screen.getByLabelText('Nombre, obligatorio'), 'Ana');
    await fireEvent.press(screen.getByRole('button', { name: 'Siguiente' }));
    await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), '5');
    await fireEvent.press(screen.getByRole('button', { name: 'Completar' }));

    await waitFor(() => expect(fake.rows.get('respuesta-1')?.is_complete).toBe(1));
    expect(fake.rows.get('respuesta-1')?.completed_at).toEqual(expect.any(String));
    expect(responsesOf(fake.rows.get('respuesta-1'))).toMatchObject({
      nombre: 'Ana',
      cantidad: 5,
    });
    // El autoguardado pendiente se canceló: la única escritura de la respuesta es la de completar.
    await advance(2000);
    expect(responseWrites(fake.statements)).toHaveLength(1);
    expect(screen.getByTestId('estado')).not.toHaveTextContent('error');
  });
});
