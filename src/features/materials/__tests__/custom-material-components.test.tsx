import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { summarizeMaterials, type VisitMaterial } from '@/models/material.model';

import { ADD_MATERIAL_MESSAGES, AddMaterialSheet } from '../components/AddMaterialSheet';
import { EditMaterialDialog } from '../components/EditMaterialDialog';
import { MaterialListTile } from '../components/MaterialListTile';
import { MaterialsSummary } from '../components/MaterialsSummary';
import { CUSTOM_MATERIAL_MESSAGES, MATERIAL_MESSAGES } from '../validation';

/** Interfaz de los materiales personalizados (fuera del catálogo). */

// Catálogo vacío: la opción de material personalizado debe estar disponible igual.
jest.mock('@powersync/react', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: undefined }),
}));

const material = (overrides: Partial<VisitMaterial> = {}): VisitMaterial => ({
  id: 'vm1',
  visitId: 'v1',
  materialId: null,
  isCustom: true,
  materialCode: 'PERSONALIZADO',
  materialName: 'Abrazadera especial',
  unit: 'bolsa',
  quantity: 3,
  observations: null,
  syncStatus: 'pendingSync',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  ...overrides,
});

const setup = () => {
  const props = {
    addedMaterialIds: new Set<string>(),
    onDismiss: jest.fn(),
    onSubmit: jest.fn(),
    onSubmitCustom: jest.fn(),
    isSubmitting: false,
  };
  return { props, view: render(<AddMaterialSheet {...props} />) };
};

const chooseUnit = async (label: string) => {
  await fireEvent.press(screen.getByTestId('custom-material-unit'));
  await fireEvent.press(screen.getByRole('radio', { name: label }));
};

describe('AddMaterialSheet: material que no está en el catálogo', () => {
  it('la opción se ve aunque el catálogo no esté disponible y abre el formulario', async () => {
    const { view } = setup();
    await view;
    expect(screen.getByText(ADD_MATERIAL_MESSAGES.emptyCatalog)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: ADD_MATERIAL_MESSAGES.addCustom }));

    expect(screen.getByLabelText('Nombre del material, obligatorio')).toBeOnTheScreen();
    expect(screen.getByText(ADD_MATERIAL_MESSAGES.customHint)).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: ADD_MATERIAL_MESSAGES.backToCatalog }),
    );
    expect(screen.getByLabelText('Buscar material')).toBeOnTheScreen();
  });

  it('envía nombre, unidad elegida, cantidad con coma y observaciones', async () => {
    const { props, view } = setup();
    await view;
    await fireEvent.press(screen.getByTestId('add-custom-material'));

    await fireEvent.changeText(
      screen.getByLabelText('Nombre del material, obligatorio'),
      '  Abrazadera  especial ',
    );
    await chooseUnit('Caja');
    await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), '2,5');
    await fireEvent.changeText(screen.getByLabelText('Observaciones'), ' tramo A ');
    await fireEvent.press(screen.getByRole('button', { name: 'Agregar' }));

    expect(props.onSubmitCustom).toHaveBeenCalledWith({
      name: 'Abrazadera especial',
      unit: 'caja',
      quantity: 2.5,
      observations: 'tramo A',
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('"Otra" permite escribir la unidad', async () => {
    const { props, view } = setup();
    await view;
    await fireEvent.press(screen.getByTestId('add-custom-material'));
    await fireEvent.changeText(screen.getByLabelText('Nombre del material, obligatorio'), 'Cal');
    await chooseUnit('Otra (escribirla)');
    await fireEvent.changeText(screen.getByLabelText('Escribe la unidad, obligatorio'), ' bolsa ');
    await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), '4');
    await fireEvent.press(screen.getByRole('button', { name: 'Agregar' }));

    expect(props.onSubmitCustom).toHaveBeenCalledWith({
      name: 'Cal',
      unit: 'bolsa',
      quantity: 4,
      observations: null,
    });
  });

  it('muestra los errores de validación y no envía', async () => {
    const { props, view } = setup();
    await view;
    await fireEvent.press(screen.getByTestId('add-custom-material'));
    await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), '0');
    await fireEvent.press(screen.getByRole('button', { name: 'Agregar' }));

    expect(await screen.findByText(CUSTOM_MATERIAL_MESSAGES.nameRequired)).toBeOnTheScreen();
    expect(screen.getByText(CUSTOM_MATERIAL_MESSAGES.unitRequired)).toBeOnTheScreen();
    expect(screen.getByText(MATERIAL_MESSAGES.quantityPositive)).toBeOnTheScreen();

    await chooseUnit('Otra (escribirla)');
    await fireEvent.press(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText(CUSTOM_MATERIAL_MESSAGES.otherUnitRequired)).toBeOnTheScreen();
    expect(props.onSubmitCustom).not.toHaveBeenCalled();
  });

  it('muestra el error al guardar (p. ej. repetido)', async () => {
    const view = render(
      <AddMaterialSheet
        addedMaterialIds={new Set()}
        onDismiss={jest.fn()}
        onSubmit={jest.fn()}
        onSubmitCustom={jest.fn()}
        isSubmitting={false}
        error="Ya agregaste un material personalizado con ese nombre."
      />,
    );
    await view;
    await fireEvent.press(screen.getByTestId('add-custom-material'));
    expect(
      screen.getByText('Ya agregaste un material personalizado con ese nombre.'),
    ).toBeOnTheScreen();
  });
});

describe('marca "Personalizado"', () => {
  it('la lista la muestra en lugar del código', async () => {
    await render(
      <MaterialListTile material={material()} readOnly onEdit={jest.fn()} onRemove={jest.fn()} />,
    );
    const tile = screen.getByTestId('material-vm1');
    expect(within(tile).getByText('Personalizado')).toBeOnTheScreen();
    expect(within(tile).queryByText('PERSONALIZADO')).toBeNull();
    expect(
      screen.getByLabelText('Abrazadera especial, material personalizado, 3 bolsa'),
    ).toBeOnTheScreen();
  });

  it('el diálogo de edición también', async () => {
    await render(
      <EditMaterialDialog
        material={material()}
        onDismiss={jest.fn()}
        onSubmit={jest.fn()}
        isSubmitting={false}
      />,
    );
    expect(screen.getByText('Personalizado')).toBeOnTheScreen();
  });

  it('el resumen indica cuántos son personalizados', async () => {
    const summary = summarizeMaterials([
      material(),
      material({ id: 'vm2', isCustom: false, materialId: 'm1', unit: 'bolsa', quantity: 1 }),
    ]);
    await render(<MaterialsSummary summary={summary} />);
    expect(screen.getByText('Incluye 1 personalizado (fuera del catálogo)')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('2 materiales, 1 personalizado. Totales: 4 bolsa'),
    ).toBeOnTheScreen();
  });
});
