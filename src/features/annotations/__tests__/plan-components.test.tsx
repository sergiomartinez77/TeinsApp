/**
 * @jest-environment ./jest.skia-environment.js
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type {
  AnnotationElement,
  AnnotationFigure,
  VisitAnnotation,
} from '@/models/annotation.model';

import { FigureLibraryDialog } from '../components/FigureLibraryDialog';
import { NameDialog } from '../components/NameDialog';
import { PlanCard } from '../components/PlanCard';
import { PlanPreview } from '../components/PlanPreview';
import { SelectionBar, selectionLabel } from '../components/SelectionBar';

jest.mock('react-native-reanimated', () =>
  jest.requireActual('@/test-utils/reanimated-mock').reanimatedMock(),
);

const line: AnnotationElement = {
  id: 'l1',
  type: 'line',
  points: [
    { x: 0, y: 0 },
    { x: 120, y: 80 },
  ],
  color: 0xff0d4f8b,
  strokeWidth: 3,
  text: null,
  fontSize: null,
  opacity: 1,
};

const figure = (overrides: Partial<AnnotationFigure> = {}): AnnotationFigure => ({
  id: 'f1',
  technicianId: 't1',
  name: 'Cuadro eléctrico',
  elements: [line],
  width: 120,
  height: 80,
  createdAt: '2026-11-22T10:00:00.000Z',
  ...overrides,
});

const plan = (overrides: Partial<VisitAnnotation> = {}): VisitAnnotation => ({
  id: 'p1',
  visitId: 'v1',
  title: null,
  elements: [line],
  baseImagePath: null,
  formatVersion: 2,
  canvasWidth: null,
  canvasHeight: null,
  syncStatus: 'pendingSync',
  createdAt: '2026-11-22T10:00:00.000Z',
  updatedAt: '2026-11-22T10:05:00.000Z',
  ...overrides,
});

describe('NameDialog', () => {
  const setup = async (props: { required?: boolean; initialValue?: string } = {}) => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(
      <NameDialog
        title="Nuevo plano"
        label="Nombre del plano"
        confirmLabel="Crear"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />,
    );
    return { onConfirm, onCancel };
  };

  it('confirma el nombre sin espacios sobrantes', async () => {
    const { onConfirm } = await setup();

    await fireEvent.changeText(screen.getByTestId('name-dialog-input'), '  Planta baja  ');
    await fireEvent.press(screen.getByTestId('name-dialog-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('Planta baja');
  });

  it('sin "required" acepta un nombre vacío (el plano queda como "Plano N")', async () => {
    const { onConfirm } = await setup();

    await fireEvent.press(screen.getByTestId('name-dialog-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('con "required" no acepta un nombre vacío', async () => {
    const { onConfirm } = await setup({ required: true });

    const confirm = screen.getByTestId('name-dialog-confirm');
    expect(confirm).toBeDisabled();
    await fireEvent.press(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('parte del nombre actual y cancela sin confirmar', async () => {
    const { onConfirm, onCancel } = await setup({ initialValue: 'Cocina' });

    expect(screen.getByTestId('name-dialog-input')).toHaveDisplayValue('Cocina');
    await fireEvent.press(screen.getByTestId('name-dialog-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('SelectionBar', () => {
  it('cuenta lo seleccionado y avisa de cada acción', async () => {
    const handlers = {
      onDuplicate: jest.fn(),
      onSaveFigure: jest.fn(),
      onDelete: jest.fn(),
      onClear: jest.fn(),
    };
    await render(<SelectionBar count={3} {...handlers} />);

    expect(screen.getByText('3 elementos seleccionados')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Duplicar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar como figura' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Borrar lo seleccionado' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar la selección' }));

    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
    expect(handlers.onSaveFigure).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
  });

  it('usa el singular con un elemento', () => {
    expect(selectionLabel(1)).toBe('1 elemento seleccionado');
  });
});

describe('PlanPreview', () => {
  it('pinta la miniatura con Skia, también sin elementos', async () => {
    await render(
      <>
        <PlanPreview elements={[line]} width={96} height={72} testID="con" />
        <PlanPreview elements={[]} width={96} height={72} testID="sin" />
      </>,
    );

    expect(screen.getByTestId('con', { includeHiddenElements: true })).toHaveStyle({
      width: 96,
      height: 72,
    });
    expect(screen.getByTestId('sin', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});

describe('FigureLibraryDialog', () => {
  const setup = async (figures: AnnotationFigure[], isLoading = false) => {
    const handlers = { onInsert: jest.fn(), onDelete: jest.fn(), onClose: jest.fn() };
    await render(<FigureLibraryDialog figures={figures} isLoading={isLoading} {...handlers} />);
    return handlers;
  };

  it('sin figuras explica cómo crearlas', async () => {
    await setup([]);
    expect(screen.getByText('Aún no tienes figuras')).toBeOnTheScreen();
  });

  it('mientras carga lo dice', async () => {
    await setup([], true);
    expect(screen.getByText('Cargando figuras...')).toBeOnTheScreen();
  });

  it('muestra nombre y tamaño; tocar una la inserta', async () => {
    const handlers = await setup([figure()]);

    expect(screen.getByText('1,2 m × 80 cm')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Insertar Cuadro eléctrico' }));

    expect(handlers.onInsert).toHaveBeenCalledWith(figure());
  });

  it('eliminar pide confirmación', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const handlers = await setup([figure()]);

    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar Cuadro eléctrico' }));
    expect(handlers.onDelete).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0]?.[2] ?? [];
    buttons.find((button) => button.style === 'destructive')?.onPress?.();
    expect(handlers.onDelete).toHaveBeenCalledWith(figure());
    alert.mockRestore();
  });

  it('cerrar avisa', async () => {
    const handlers = await setup([figure()]);
    await fireEvent.press(screen.getByTestId('figure-close'));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PlanCard', () => {
  const setup = async (editable: boolean) => {
    const handlers = { onOpen: jest.fn(), onRename: jest.fn(), onDelete: jest.fn() };
    await render(<PlanCard plan={plan()} title="Plano 1" editable={editable} {...handlers} />);
    return handlers;
  };

  it('abre, renombra y elimina el plano', async () => {
    const handlers = await setup(true);

    await fireEvent.press(screen.getByRole('button', { name: 'Abrir Plano 1, 1 elemento' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Renombrar Plano 1' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Eliminar Plano 1' }));

    expect(handlers.onOpen).toHaveBeenCalledWith(plan());
    expect(handlers.onRename).toHaveBeenCalledWith(plan());
    expect(handlers.onDelete).toHaveBeenCalledWith(plan());
  });

  it('en una visita cerrada solo se puede abrir', async () => {
    await setup(false);

    expect(screen.getByRole('button', { name: 'Abrir Plano 1, 1 elemento' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Renombrar Plano 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Eliminar Plano 1' })).toBeNull();
  });
});
