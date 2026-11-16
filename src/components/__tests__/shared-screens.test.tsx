import { fireEvent, render, screen } from '@testing-library/react-native';

import { APP_ERROR_MESSAGES, AppErrorScreen } from '@/components/layout/AppErrorScreen';
import { NOT_FOUND_MESSAGES, NotFoundView } from '@/components/layout/NotFoundView';
import { ErrorMessage, ReadOnlyNotice } from '@/components/ui';
import { contentWidths } from '@/theme';

const mockLogError = jest.fn();
jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    // Se llama en diferido: el módulo se carga antes de crear `mockLogError`.
    error: (...args: unknown[]) => mockLogError(...args),
  }),
}));

afterEach(() => {
  mockLogError.mockClear();
});

describe('ErrorMessage', () => {
  it('muestra el mensaje como alerta', async () => {
    await render(<ErrorMessage message="No se pudo guardar el material." testID="error-message" />);

    const box = screen.getByTestId('error-message');
    expect(box).toHaveProp('accessibilityRole', 'alert');
    expect(box).toHaveTextContent(/No se pudo guardar el material\./);
  });
});

describe('ReadOnlyNotice', () => {
  it('anuncia el aviso de visita cerrada con texto, no solo con color', async () => {
    const message = 'La visita está cerrada: los materiales son de solo lectura.';
    await render(<ReadOnlyNotice message={message} />);

    expect(screen.getByLabelText(message)).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
  });

  it('también existe como franja (anotaciones)', async () => {
    await render(<ReadOnlyNotice message="Solo lectura" variant="bar" />);
    expect(screen.getByTestId('read-only-notice')).toBeOnTheScreen();
  });
});

describe('AppErrorScreen', () => {
  it('explica el problema en español sin mostrar el error técnico y lo registra', async () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'id')");
    const retry = jest.fn(async () => undefined);

    await render(<AppErrorScreen error={error} retry={retry} />);

    expect(screen.getByRole('header', { name: APP_ERROR_MESSAGES.title })).toBeOnTheScreen();
    expect(screen.getByText(/datos guardados en el dispositivo están a salvo/)).toBeOnTheScreen();
    expect(screen.queryByText(/Cannot read|undefined|TypeError/)).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: APP_ERROR_MESSAGES.retry }));
    expect(retry).toHaveBeenCalledTimes(1);

    expect(mockLogError).toHaveBeenCalledWith('Error no controlado en la interfaz', error);
  });
});

describe('NotFoundView', () => {
  it('avisa en español y vuelve al inicio', async () => {
    const onGoHome = jest.fn();
    await render(<NotFoundView onGoHome={onGoHome} />);

    expect(screen.getByRole('header', { name: NOT_FOUND_MESSAGES.title })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: NOT_FOUND_MESSAGES.goHome }));
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });
});

describe('contentWidths', () => {
  it('ordena los anchos máximos de contenido de menor a mayor', () => {
    const { narrow, sheet, form, list, wide } = contentWidths;
    expect([narrow, sheet, form, list, wide]).toEqual([480, 640, 720, 840, 1100]);
  });
});
