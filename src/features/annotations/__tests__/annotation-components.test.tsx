import { fireEvent, render, screen } from '@testing-library/react-native';

import { AnnotationToolbar, type AnnotationToolbarProps } from '../components/AnnotationToolbar';
import { TextElementDialog } from '../components/TextElementDialog';
import { ANNOTATION_DEFAULTS, ANNOTATION_PALETTE, TEXT_MAX_LENGTH } from '../constants';

const RED = ANNOTATION_PALETTE[1]?.argb ?? 0;

const renderToolbar = async (overrides: Partial<AnnotationToolbarProps> = {}) => {
  const props: AnnotationToolbarProps = {
    tool: ANNOTATION_DEFAULTS.tool,
    color: ANNOTATION_DEFAULTS.color,
    sizeId: ANNOTATION_DEFAULTS.size,
    canUndo: false,
    onToolChange: jest.fn(),
    onColorChange: jest.fn(),
    onSizeChange: jest.fn(),
    onUndo: jest.fn(),
    ...overrides,
  };
  await render(<AnnotationToolbar {...props} />);
  return props;
};

describe('AnnotationToolbar', () => {
  it('tiene una etiqueta accesible para cada herramienta, color y grosor', async () => {
    await renderToolbar();

    for (const label of [
      'Lápiz',
      'Línea',
      'Flecha',
      'Rectángulo',
      'Círculo',
      'Texto',
      'Marcador',
      'Borrador',
      'Color negro',
      'Color rojo',
      'Color azul',
      'Color verde',
      'Color naranja',
      'Color morado',
      'Grosor fino',
      'Grosor medio',
      'Grosor grueso',
      'Deshacer',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
    }
  });

  it('marca como seleccionados el lápiz, el azul y el grosor medio por defecto', async () => {
    await renderToolbar();

    expect(screen.getByRole('button', { name: 'Lápiz' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Línea' })).not.toBeSelected();
    expect(screen.getByRole('button', { name: 'Color azul' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Color rojo' })).not.toBeSelected();
    expect(screen.getByRole('button', { name: 'Grosor medio' })).toBeSelected();
  });

  it('seleccionar herramienta, color y grosor avisa del cambio', async () => {
    const props = await renderToolbar();

    await fireEvent.press(screen.getByRole('button', { name: 'Borrador' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Color rojo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Grosor grueso' }));

    expect(props.onToolChange).toHaveBeenCalledWith('eraser');
    expect(props.onColorChange).toHaveBeenCalledWith(RED);
    expect(props.onSizeChange).toHaveBeenCalledWith('thick');
  });

  it('muestra la selección recibida', async () => {
    await renderToolbar({ tool: 'circle', color: RED, sizeId: 'thin' });

    expect(screen.getByRole('button', { name: 'Círculo' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Color rojo' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Grosor fino' })).toBeSelected();
  });

  it('deshacer está deshabilitado si no hay nada que deshacer', async () => {
    const props = await renderToolbar({ canUndo: false });

    const undo = screen.getByRole('button', { name: 'Deshacer' });
    expect(undo).toBeDisabled();
    await fireEvent.press(undo);
    expect(props.onUndo).not.toHaveBeenCalled();
  });

  it('deshacer está habilitado si hay cambios', async () => {
    const props = await renderToolbar({ canUndo: true });

    const undo = screen.getByRole('button', { name: 'Deshacer' });
    expect(undo).toBeEnabled();
    await fireEvent.press(undo);
    expect(props.onUndo).toHaveBeenCalledTimes(1);
  });

  it('también funciona en columna lateral', async () => {
    await renderToolbar({ layout: 'side' });

    expect(screen.getByRole('button', { name: 'Lápiz' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeOnTheScreen();
  });
});

describe('TextElementDialog', () => {
  const setup = async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(<TextElementDialog onConfirm={onConfirm} onCancel={onCancel} />);
    return { onConfirm, onCancel };
  };

  it('confirma el texto sin espacios sobrantes', async () => {
    const { onConfirm, onCancel } = await setup();

    await fireEvent.changeText(screen.getByTestId('text-element-input'), '  Tablero principal  ');
    await fireEvent.press(screen.getByTestId('text-element-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('Tablero principal');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('un texto vacío cancela', async () => {
    const { onConfirm, onCancel } = await setup();

    await fireEvent.changeText(screen.getByTestId('text-element-input'), '    ');
    await fireEvent.press(screen.getByTestId('text-element-confirm'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('limita el texto a 120 caracteres', async () => {
    const { onConfirm } = await setup();

    const input = screen.getByTestId('text-element-input');
    expect(input).toHaveProp('maxLength', TEXT_MAX_LENGTH);
    await fireEvent.changeText(input, 'a'.repeat(150));
    await fireEvent.press(screen.getByTestId('text-element-confirm'));

    expect(onConfirm).toHaveBeenCalledWith('a'.repeat(TEXT_MAX_LENGTH));
  });

  it('cancelar no añade nada', async () => {
    const { onConfirm, onCancel } = await setup();

    await fireEvent.press(screen.getByTestId('text-element-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
