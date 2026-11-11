import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LoginForm, type LoginFormProps } from '../components/LoginForm';
import { loginSchema } from '../validation';

function setup(overrides: Partial<LoginFormProps> = {}) {
  const props: LoginFormProps = {
    onSubmit: jest.fn(),
    onDemo: jest.fn(),
    isSubmitting: false,
    error: null,
    ...overrides,
  };
  return { props, view: render(<LoginForm {...props} />) };
}

describe('loginSchema', () => {
  it('acepta credenciales válidas y recorta espacios del correo', () => {
    const result = loginSchema.safeParse({ email: '  tecnico@example.com ', password: 'clave' });
    expect(result.success && result.data.email).toBe('tecnico@example.com');
  });

  it('exige correo válido y contraseña', () => {
    const empty = loginSchema.safeParse({ email: ' ', password: '' });
    const messages = empty.success ? [] : empty.error.issues.map((issue) => issue.message);
    expect(messages).toEqual(['Ingresa tu correo electrónico.', 'Ingresa tu contraseña.']);

    const invalid = loginSchema.safeParse({ email: 'no-es-correo', password: 'x' });
    expect(invalid.success ? '' : invalid.error.issues[0]?.message).toBe(
      'El correo electrónico no es válido.',
    );
  });
});

describe('LoginForm', () => {
  it('no envía y muestra los errores si los campos están vacíos', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Ingresa tu correo electrónico.')).toBeOnTheScreen();
    expect(screen.getByText('Ingresa tu contraseña.')).toBeOnTheScreen();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('envía el correo y la contraseña cuando son válidos', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'tecnico@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'clave-segura');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
    expect(jest.mocked(props.onSubmit).mock.calls[0]?.[0]).toEqual({
      email: 'tecnico@example.com',
      password: 'clave-segura',
    });
  });

  it('muestra el error del servidor y avisa al editar para limpiarlo', async () => {
    const onEdit = jest.fn();
    const { view } = setup({ error: 'Correo o contraseña incorrectos.', onEdit });
    await view;

    expect(screen.getByText('Correo o contraseña incorrectos.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'otra');
    expect(onEdit).toHaveBeenCalled();
  });

  it('bloquea el formulario mientras se inicia sesión', async () => {
    const { props, view } = setup({ isSubmitting: true });
    await view;

    expect(screen.getByTestId('login-submit')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continuar en modo demo' })).toBeDisabled();

    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('permite entrar en modo demo', async () => {
    const { props, view } = setup();
    await view;

    await fireEvent.press(screen.getByRole('button', { name: 'Continuar en modo demo' }));

    expect(props.onDemo).toHaveBeenCalledTimes(1);
  });
});
