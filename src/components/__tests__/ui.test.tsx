import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { AppBar } from '@/components/layout/AppBar';
import {
  Badge,
  Button,
  Card,
  ConnectivityBanner,
  EmptyState,
  ErrorScreen,
  IconButton,
  Input,
  LoadingScreen,
} from '@/components/ui';
import { colors, spacing } from '@/theme';

const mockRouter = {
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
});

describe('Button', () => {
  it('ejecuta onPress y cumple el área táctil mínima', async () => {
    const onPress = jest.fn();
    await render(<Button label="Iniciar sesión" onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Iniciar sesión' });
    await fireEvent.press(button);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(button.props.style).minHeight).toBe(spacing.minTouchTarget);
  });

  it('no responde cuando está deshabilitado o cargando', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <Button label="Deshabilitado" onPress={onPress} disabled />
        <Button label="Cargando" onPress={onPress} loading />
      </>,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Deshabilitado' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cargando' }));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cargando' })).toBeBusy();
    expect(screen.getByRole('button', { name: 'Deshabilitado' })).toBeDisabled();
  });

  it('aplica el estilo de cada variante', async () => {
    await render(
      <>
        <Button label="Primario" onPress={jest.fn()} />
        <Button label="Contorno" onPress={jest.fn()} variant="outlined" />
      </>,
    );

    const primary = StyleSheet.flatten(
      screen.getByRole('button', { name: 'Primario' }).props.style,
    );
    const outlined = StyleSheet.flatten(
      screen.getByRole('button', { name: 'Contorno' }).props.style,
    );

    expect(primary.backgroundColor).toBe(colors.primary);
    expect(outlined.borderColor).toBe(colors.primary);
    expect(outlined.borderWidth).toBe(1.5);
  });
});

describe('Input', () => {
  it('muestra la etiqueta, propaga cambios y muestra el error', async () => {
    const onChangeText = jest.fn();
    await render(
      <Input
        label="Correo electrónico"
        value=""
        onChangeText={onChangeText}
        error="Ingresa tu correo."
        required
      />,
    );

    await fireEvent.changeText(
      screen.getByLabelText('Correo electrónico, obligatorio'),
      'tecnico@example.com',
    );

    expect(onChangeText).toHaveBeenCalledWith('tecnico@example.com');
    expect(screen.getByText('Ingresa tu correo.')).toBeOnTheScreen();
  });

  it('oculta la contraseña y permite mostrarla', async () => {
    await render(<Input label="Contraseña" value="secreto" onChangeText={jest.fn()} password />);

    const field = screen.getByLabelText('Contraseña');
    expect(field.props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByRole('button', { name: 'Mostrar contraseña' }));

    expect(screen.getByLabelText('Contraseña').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toBeOnTheScreen();
  });
});

describe('Card', () => {
  it('solo es pulsable cuando recibe onPress', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <Card>
          <Text>Estática</Text>
        </Card>
        <Card onPress={onPress} accessibilityLabel="Abrir visita">
          <Text>Pulsable</Text>
        </Card>
      </>,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Abrir visita' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Badge', () => {
  it('usa el color del estado con 12 % de fondo y 40 % de borde', async () => {
    await render(<Badge label="En progreso" color={colors.visitInProgress} testID="badge" />);

    const style = StyleSheet.flatten(screen.getByTestId('badge').props.style);

    expect(screen.getByText('En progreso')).toBeOnTheScreen();
    expect(style.backgroundColor).toBe('rgba(245, 127, 23, 0.12)');
    expect(style.borderColor).toBe('rgba(245, 127, 23, 0.4)');
  });
});

describe('pantallas de estado', () => {
  it('LoadingScreen muestra el mensaje por defecto', async () => {
    await render(<LoadingScreen />);
    expect(screen.getByText('Cargando...')).toBeOnTheScreen();
  });

  it('ErrorScreen muestra Reintentar solo si hay acción', async () => {
    const onRetry = jest.fn();
    const view = await render(<ErrorScreen message="No se pudieron cargar las visitas." />);
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();

    await view.rerender(
      <ErrorScreen message="No se pudieron cargar las visitas." onRetry={onRetry} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('EmptyState muestra mensaje e instrucción', async () => {
    await render(
      <EmptyState
        icon="inventory-2"
        message="Sin materiales"
        hint="Toca “Agregar material” para registrar el primero."
      />,
    );

    expect(screen.getByText('Sin materiales')).toBeOnTheScreen();
    expect(screen.getByText(/Agregar material/)).toBeOnTheScreen();
  });
});

describe('ConnectivityBanner', () => {
  it('informa el estado con texto en español y mide 28dp', async () => {
    const view = await render(<ConnectivityBanner isOnline={false} />);

    expect(screen.getByText('Sin conexión — trabajando localmente')).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByTestId('connectivity-banner').props.style).height).toBe(
      28,
    );

    await view.rerender(<ConnectivityBanner isOnline />);
    expect(screen.getByText('Conectado')).toBeOnTheScreen();
  });
});

describe('IconButton', () => {
  it('tiene nombre accesible y área táctil de 48dp', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="save" accessibilityLabel="Guardar" onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Guardar' });
    await fireEvent.press(button);
    const style = StyleSheet.flatten(button.props.style);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(style.width).toBe(48);
    expect(style.height).toBe(48);
  });
});

describe('AppBar', () => {
  it('muestra el título y vuelve atrás por defecto', async () => {
    await render(<AppBar title="Materiales" />);

    expect(screen.getByRole('header', { name: 'Materiales' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('va al inicio si no hay pantalla anterior', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await render(<AppBar title="Detalle" />);

    await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));

    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('usa onBack si se indica y oculta el botón con showBack=false', async () => {
    const onBack = jest.fn();
    const view = await render(<AppBar title="Formulario" onBack={onBack} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();

    await view.rerender(<AppBar title="TEINS" showBack={false} actions={<Text>Salir</Text>} />);
    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull();
    expect(screen.getByText('Salir')).toBeOnTheScreen();
  });
});
