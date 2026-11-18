import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { summarizeMaterials, type VisitMaterial } from '@/models/material.model';

import { ADD_MATERIAL_MESSAGES, AddMaterialSheet } from '../components/AddMaterialSheet';
import { EditMaterialDialog } from '../components/EditMaterialDialog';
import { MaterialListTile } from '../components/MaterialListTile';
import { MaterialsSummary } from '../components/MaterialsSummary';
import { MATERIAL_MESSAGES } from '../validation';

type Row = Record<string, unknown>;

const catalogRow = (id: string, code: string, name: string, unit: string): Row => ({
  id,
  code,
  name,
  unit,
  description: null,
  category: null,
  is_active: 1,
});

const BASE_CATALOG: Row[] = [
  catalogRow('m1', 'CAB-001', 'Cable UTP Cat6', 'metro'),
  catalogRow('m2', 'CIN-010', 'Cinta aislante', 'unidad'),
  catalogRow('m3', 'CON-020', 'Conector RJ45', 'unidad'),
];

let mockCatalogRows: Row[] = BASE_CATALOG;

// Simula la consulta reactiva del catálogo: filtra por el patrón y aplica el límite.
jest.mock('@powersync/react', () => ({
  useQuery: (_sql: string, parameters: unknown[]) => {
    const limit = Number(parameters[parameters.length - 1]);
    const needle = parameters.length > 1 ? String(parameters[0]).slice(1, -1).toLowerCase() : '';
    const data = mockCatalogRows
      .filter(
        (row) =>
          !needle ||
          String(row.code).toLowerCase().includes(needle) ||
          String(row.name).toLowerCase().includes(needle),
      )
      .slice(0, limit);
    return { data, isLoading: false, error: undefined };
  },
}));

const visitMaterial = (overrides: Partial<VisitMaterial> = {}): VisitMaterial => ({
  id: 'vm1',
  visitId: 'v1',
  isCustom: false,
  materialId: 'm1',
  materialCode: 'CAB-001',
  materialName: 'Cable UTP Cat6',
  unit: 'metro',
  quantity: 12.5,
  observations: 'Tramo sala 2',
  syncStatus: 'pendingSync',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mockCatalogRows = BASE_CATALOG;
});

describe('MaterialListTile', () => {
  it('muestra código, nombre, cantidad con unidad y observaciones', async () => {
    await render(
      <MaterialListTile
        material={visitMaterial()}
        readOnly={false}
        onEdit={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    expect(screen.getByText('CAB-001')).toBeOnTheScreen();
    expect(screen.getByText('Cable UTP Cat6')).toBeOnTheScreen();
    expect(screen.getByText('12,5 metro')).toBeOnTheScreen();
    expect(screen.getByText('Tramo sala 2')).toBeOnTheScreen();
  });

  it('avisa al pulsar editar y quitar', async () => {
    const onEdit = jest.fn();
    const onRemove = jest.fn();
    const material = visitMaterial();
    await render(
      <MaterialListTile material={material} readOnly={false} onEdit={onEdit} onRemove={onRemove} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Editar Cable UTP Cat6' }));
    expect(onEdit).toHaveBeenCalledWith(material);
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar Cable UTP Cat6' }));
    expect(onRemove).toHaveBeenCalledWith(material);
  });

  it('en solo lectura no muestra botones', async () => {
    await render(
      <MaterialListTile
        material={visitMaterial({ observations: null })}
        readOnly
        onEdit={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Tramo sala 2')).toBeNull();
  });
});

describe('MaterialsSummary', () => {
  it('muestra el conteo y los totales por unidad', async () => {
    const summary = summarizeMaterials([
      visitMaterial({ id: 'a', quantity: 100 }),
      visitMaterial({ id: 'b', quantity: 20 }),
      visitMaterial({ id: 'c', unit: 'unidad', quantity: 14 }),
    ]);
    await render(<MaterialsSummary summary={summary} />);

    expect(screen.getByText('3 materiales')).toBeOnTheScreen();
    expect(screen.getByText('120 metro · 14 unidad')).toBeOnTheScreen();
  });

  it('sin materiales no muestra nada', async () => {
    await render(<MaterialsSummary summary={summarizeMaterials([])} />);
    expect(screen.queryByTestId('materials-summary')).toBeNull();
  });
});

describe('AddMaterialSheet', () => {
  const setup = (overrides: Partial<Parameters<typeof AddMaterialSheet>[0]> = {}) => {
    const props = {
      addedMaterialIds: new Set<string>(),
      onDismiss: jest.fn(),
      onSubmit: jest.fn(),
      isSubmitting: false,
      ...overrides,
    };
    return { props, view: render(<AddMaterialSheet {...props} />) };
  };

  it('lista el catálogo y marca como deshabilitados los ya agregados', async () => {
    const { view } = setup({ addedMaterialIds: new Set(['m1']) });
    await view;

    const added = screen.getByRole('button', { name: 'Cable UTP Cat6, ya agregado' });
    expect(added).toBeDisabled();
    expect(screen.getByText(ADD_MATERIAL_MESSAGES.alreadyAdded)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cinta aislante, código CIN-010' })).toBeEnabled();

    await fireEvent.press(added);
    expect(screen.queryByLabelText('Cantidad, obligatorio')).toBeNull();
  });

  it('busca por código o nombre', async () => {
    const { view } = setup();
    await view;

    await fireEvent.changeText(screen.getByLabelText('Buscar material'), 'rj45');
    await waitFor(() => expect(screen.queryByText('Cable UTP Cat6')).toBeNull());
    expect(screen.getByText('Conector RJ45')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Buscar material'), 'CIN-');
    expect(await screen.findByText('Cinta aislante')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Conector RJ45')).toBeNull());
  });

  it('avisa si la búsqueda no tiene resultados', async () => {
    const { view } = setup();
    await view;

    await fireEvent.changeText(screen.getByLabelText('Buscar material'), 'tornillo');

    expect(await screen.findByText(ADD_MATERIAL_MESSAGES.noResults('tornillo'))).toBeOnTheScreen();
  });

  it('avisa si el catálogo aún no está disponible', async () => {
    mockCatalogRows = [];
    const { view } = setup();
    await view;

    expect(screen.getByText(ADD_MATERIAL_MESSAGES.emptyCatalog)).toBeOnTheScreen();
  });

  it('carga más materiales de 30 en 30', async () => {
    mockCatalogRows = Array.from({ length: 35 }, (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      return catalogRow(`m${number}`, `MAT-${number}`, `Material ${number}`, 'unidad');
    });
    const { view } = setup();
    await view;

    expect(screen.getByText('Material 30')).toBeOnTheScreen();
    expect(screen.queryByText('Material 31')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Cargar más' }));

    expect(screen.getByText('Material 35')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });

  it('valida la cantidad y envía los datos normalizados', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.press(screen.getByRole('button', { name: 'Cinta aislante, código CIN-010' }));
    expect(screen.getByText('Unidad: unidad')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText(MATERIAL_MESSAGES.quantityRequired)).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), '1,2345');
    await fireEvent.press(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText(MATERIAL_MESSAGES.maxDecimals)).toBeOnTheScreen();
    expect(props.onSubmit).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), ' 12,5 ');
    await fireEvent.changeText(screen.getByLabelText('Observaciones'), '  Tablero 2  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
    expect(jest.mocked(props.onSubmit).mock.calls[0]?.[0]).toEqual({
      materialId: 'm2',
      quantity: 12.5,
      observations: 'Tablero 2',
    });
  });

  it('permite cambiar el material elegido', async () => {
    const { view } = setup();
    await view;

    await fireEvent.press(screen.getByRole('button', { name: 'Cinta aislante, código CIN-010' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cambiar material' }));

    expect(screen.getByLabelText('Buscar material')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Cantidad, obligatorio')).toBeNull();
  });

  it('muestra el error de guardado y permite cancelar', async () => {
    const { props, view } = setup({ error: 'Este material ya está en la visita.' });
    await view;

    await fireEvent.press(screen.getByRole('button', { name: 'Cable UTP Cat6, código CAB-001' }));
    expect(screen.getByText('Este material ya está en la visita.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('EditMaterialDialog', () => {
  const setup = (overrides: Partial<Parameters<typeof EditMaterialDialog>[0]> = {}) => {
    const props = {
      material: visitMaterial(),
      onDismiss: jest.fn(),
      onSubmit: jest.fn(),
      isSubmitting: false,
      ...overrides,
    };
    return { props, view: render(<EditMaterialDialog {...props} />) };
  };

  it('muestra los valores actuales con coma decimal y la unidad', async () => {
    const { view } = setup();
    await view;

    expect(screen.getByText('Cable UTP Cat6')).toBeOnTheScreen();
    expect(screen.getByLabelText('Cantidad, obligatorio')).toHaveDisplayValue('12,5');
    expect(screen.getByText('metro')).toBeOnTheScreen();
    expect(screen.getByLabelText('Observaciones')).toHaveDisplayValue('Tramo sala 2');
  });

  it('no guarda una cantidad de cero', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), '0');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(MATERIAL_MESSAGES.quantityPositive)).toBeOnTheScreen();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('envía la cantidad y las observaciones normalizadas', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), '3.75');
    await fireEvent.changeText(screen.getByLabelText('Observaciones'), '   ');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
    expect(jest.mocked(props.onSubmit).mock.calls[0]?.[0]).toEqual({
      quantity: 3.75,
      observations: null,
    });
  });

  it('muestra el error de guardado y permite cancelar', async () => {
    const { props, view } = setup({ error: 'No se pudo guardar.' });
    await view;

    expect(screen.getByText('No se pudo guardar.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });
});
