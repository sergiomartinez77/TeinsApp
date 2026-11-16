import { DEMO_USER, type UserProfile } from '@/models/user.model';
import * as authService from '@/services/supabase/auth.service';
import { appError, err, ok } from '@/types/errors';

import { useAuthStore } from '../auth.store';

jest.mock('@/services/supabase/auth.service', () => ({
  AUTH_MESSAGES: { sessionExpired: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.' },
  getStoredUser: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
  clearStoredProfile: jest.fn(),
}));

const mockLogError = jest.fn();
jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    // Se llama en diferido: el store se carga antes de crear `mockLogError`.
    error: (...args: unknown[]) => mockLogError(...args),
  }),
}));

const service = jest.mocked(authService);

const USER: UserProfile = {
  id: 'u1',
  email: 'tecnico@example.com',
  role: 'technician',
  fullName: 'Carlos Técnico',
  phone: null,
  avatarUrl: null,
};

const state = () => useAuthStore.getState();

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  service.signOut.mockResolvedValue(undefined);
  service.clearStoredProfile.mockResolvedValue(undefined);
  useAuthStore.setState({
    status: 'checking',
    user: null,
    isDemoMode: false,
    isSubmitting: false,
    error: null,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('checkSession', () => {
  it('entra directamente si hay sesión guardada', async () => {
    service.getStoredUser.mockResolvedValue(USER);

    await state().checkSession();

    expect(state()).toMatchObject({ status: 'authenticated', user: USER, isDemoMode: false });
  });

  it('queda sin sesión si no hay nada guardado', async () => {
    service.getStoredUser.mockResolvedValue(null);

    await state().checkSession();

    expect(state()).toMatchObject({ status: 'unauthenticated', user: null });
  });

  it('queda sin sesión si falla la lectura del dispositivo', async () => {
    service.getStoredUser.mockRejectedValue(new Error('keystore'));

    await state().checkSession();

    expect(state().status).toBe('unauthenticated');
  });
});

describe('signIn', () => {
  it('autentica con credenciales correctas', async () => {
    service.signIn.mockResolvedValue(ok(USER));

    const success = await state().signIn('tecnico@example.com', 'clave');

    expect(success).toBe(true);
    expect(state()).toMatchObject({
      status: 'authenticated',
      user: USER,
      isSubmitting: false,
      error: null,
    });
  });

  it('expone el mensaje de error y sigue sin sesión', async () => {
    service.signIn.mockResolvedValue(
      err(appError('authentication', { message: 'Correo o contraseña incorrectos.' })),
    );

    const success = await state().signIn('tecnico@example.com', 'mala');

    expect(success).toBe(false);
    expect(state()).toMatchObject({
      status: 'unauthenticated',
      user: null,
      isSubmitting: false,
      error: 'Correo o contraseña incorrectos.',
    });
  });

  it('marca el envío en curso e ignora un segundo intento simultáneo', async () => {
    let finish: (value: ReturnType<typeof ok<UserProfile>>) => void = () => undefined;
    service.signIn.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const first = state().signIn('tecnico@example.com', 'clave');
    expect(state().isSubmitting).toBe(true);
    expect(await state().signIn('tecnico@example.com', 'clave')).toBe(false);

    finish(ok(USER));
    expect(await first).toBe(true);
    expect(service.signIn).toHaveBeenCalledTimes(1);
  });
});

describe('modo demo', () => {
  it('entra con el usuario ficticio sin llamar al servidor', () => {
    state().enterDemoMode();

    expect(state()).toMatchObject({ status: 'authenticated', user: DEMO_USER, isDemoMode: true });
    expect(service.signIn).not.toHaveBeenCalled();
  });

  it('al salir no intenta cerrar una sesión real', async () => {
    state().enterDemoMode();

    await state().signOut();

    expect(service.signOut).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ status: 'unauthenticated', user: null, isDemoMode: false });
  });
});

describe('signOut', () => {
  it('cierra la sesión real', async () => {
    useAuthStore.setState({ status: 'authenticated', user: USER });

    await state().signOut();

    expect(service.signOut).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ status: 'unauthenticated', user: null, isSubmitting: false });
  });

  it('si falla el borrado en el dispositivo cierra igual y no rechaza la promesa', async () => {
    useAuthStore.setState({ status: 'authenticated', user: USER });
    service.signOut.mockRejectedValue(new Error('SecureStore no disponible'));

    await expect(state().signOut()).resolves.toBeUndefined();

    expect(state()).toMatchObject({ status: 'unauthenticated', user: null, isSubmitting: false });
    expect(mockLogError).toHaveBeenCalledWith(
      'No se pudo borrar la sesión guardada en el dispositivo',
      expect.any(Error),
    );
  });
});

describe('handleSessionEnded', () => {
  it('saca al usuario con un aviso cuando la sesión expira', () => {
    useAuthStore.setState({ status: 'authenticated', user: USER });

    state().handleSessionEnded();

    expect(state()).toMatchObject({
      status: 'unauthenticated',
      user: null,
      error: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
    });
    expect(service.clearStoredProfile).toHaveBeenCalledTimes(1);
  });

  it('si falla el borrado del perfil lo registra sin dejar la promesa sin capturar', async () => {
    useAuthStore.setState({ status: 'authenticated', user: USER });
    service.clearStoredProfile.mockRejectedValue(new Error('SecureStore no disponible'));

    state().handleSessionEnded();
    await Promise.resolve();
    await Promise.resolve();

    expect(state().status).toBe('unauthenticated');
    expect(mockLogError).toHaveBeenCalledWith(
      'No se pudo borrar el perfil guardado',
      expect.any(Error),
    );
  });

  it('no afecta al modo demo ni a quien ya está sin sesión', () => {
    state().enterDemoMode();
    state().handleSessionEnded();
    expect(state().status).toBe('authenticated');

    useAuthStore.setState({ status: 'unauthenticated', user: null, isDemoMode: false });
    state().handleSessionEnded();
    expect(state().error).toBeNull();
  });
});
