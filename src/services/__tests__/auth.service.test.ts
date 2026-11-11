import type { SupabaseClient } from '@supabase/supabase-js';

import { SECURE_KEYS } from '@/constants/app.constants';

import {
  AUTH_MESSAGES,
  getStoredUser,
  mapAuthError,
  onSessionEnded,
  signIn,
  signOut,
} from '../supabase/auth.service';

const mockStore = new Map<string, string>();

jest.mock('../storage/secure-storage', () => ({
  getSecureItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setSecureItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeSecureItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('../supabase/client', () => ({
  getSupabase: jest.fn(() => {
    throw new Error('Los tests deben inyectar el cliente');
  }),
}));

interface FakeOptions {
  signIn?: { data: { user: unknown }; error: unknown };
  profile?: { data: unknown; error: unknown } | Error;
  signOutError?: unknown;
}

function createSupabase(options: FakeOptions = {}) {
  const maybeSingle = jest.fn(async () => {
    if (options.profile instanceof Error) throw options.profile;
    return options.profile ?? { data: null, error: null };
  });
  const from = jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
  const unsubscribe = jest.fn();
  let authListener: (event: string) => void = () => undefined;

  const auth = {
    signInWithPassword: jest.fn(
      async () => options.signIn ?? { data: { user: null }, error: null },
    ),
    signOut: jest.fn(async () => {
      if (options.signOutError instanceof Error) throw options.signOutError;
      return { error: options.signOutError ?? null };
    }),
    onAuthStateChange: jest.fn((listener: (event: string) => void) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe } } };
    }),
  };

  return {
    client: { auth, from } as unknown as SupabaseClient,
    auth,
    from,
    unsubscribe,
    emit: (event: string) => authListener(event),
  };
}

const AUTH_USER = {
  id: 'u1',
  email: 'tecnico@example.com',
  user_metadata: { full_name: 'Nombre De Sesión', role: 'technician' },
};

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('mapAuthError', () => {
  it.each([
    [{ code: 'invalid_credentials', status: 400 }, AUTH_MESSAGES.invalidCredentials],
    [{ message: 'Invalid login credentials' }, AUTH_MESSAGES.invalidCredentials],
    [{ message: 'Email not confirmed' }, AUTH_MESSAGES.emailNotConfirmed],
    [{ status: 429, message: 'Too many requests' }, AUTH_MESSAGES.rateLimit],
    [{ code: 'over_request_rate_limit' }, AUTH_MESSAGES.rateLimit],
    [{ name: 'AuthRetryableFetchError', status: 0 }, AUTH_MESSAGES.offline],
    [new TypeError('Network request failed'), AUTH_MESSAGES.offline],
    [{ message: 'algo raro' }, AUTH_MESSAGES.unknown],
    [null, AUTH_MESSAGES.unknown],
  ])('traduce %p', (error, expected) => {
    expect(mapAuthError(error).message).toBe(expected);
  });

  it('clasifica los fallos del servidor y de red', () => {
    expect(mapAuthError({ status: 503, message: 'unavailable' }).kind).toBe('server');
    expect(mapAuthError(new TypeError('Network request failed')).kind).toBe('network');
  });
});

describe('signIn', () => {
  it('usa el perfil de la tabla profiles y lo guarda en el dispositivo', async () => {
    const { client, auth } = createSupabase({
      signIn: { data: { user: AUTH_USER }, error: null },
      profile: {
        data: {
          id: 'u1',
          email: 'tecnico@example.com',
          full_name: 'Carlos Técnico',
          role: 'technician',
        },
        error: null,
      },
    });

    const result = await signIn('  Tecnico@Example.com ', 'clave', client);

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'tecnico@example.com',
      password: 'clave',
    });
    expect(result).toMatchObject({ ok: true, data: { id: 'u1', fullName: 'Carlos Técnico' } });
    expect(JSON.parse(mockStore.get(SECURE_KEYS.userProfile) ?? '{}')).toMatchObject({
      id: 'u1',
      fullName: 'Carlos Técnico',
    });
    expect(mockStore.get(SECURE_KEYS.userId)).toBe('u1');
  });

  it.each([
    ['la consulta devuelve error', { data: null, error: { message: 'rls' } }],
    ['no existe la fila', { data: null, error: null }],
    ['la consulta falla por red', new TypeError('Network request failed')],
  ])('usa los datos de la sesión si %s', async (_caso, profile) => {
    const { client } = createSupabase({
      signIn: { data: { user: AUTH_USER }, error: null },
      profile,
    });

    const result = await signIn('tecnico@example.com', 'clave', client);

    expect(result).toMatchObject({ ok: true, data: { fullName: 'Nombre De Sesión' } });
  });

  it('devuelve el mensaje en español y no guarda nada si las credenciales fallan', async () => {
    const { client, from } = createSupabase({
      signIn: { data: { user: null }, error: { code: 'invalid_credentials', status: 400 } },
    });

    const result = await signIn('tecnico@example.com', 'mala', client);

    expect(result).toMatchObject({
      ok: false,
      error: { message: AUTH_MESSAGES.invalidCredentials },
    });
    expect(from).not.toHaveBeenCalled();
    expect(mockStore.size).toBe(0);
  });

  it('nunca lanza: una excepción se convierte en error tipado', async () => {
    const { client, auth } = createSupabase();
    auth.signInWithPassword.mockRejectedValue(new TypeError('Network request failed'));

    const result = await signIn('tecnico@example.com', 'clave', client);

    expect(result).toMatchObject({ ok: false, error: { kind: 'network' } });
  });
});

describe('sesión guardada', () => {
  const profile = {
    id: 'u1',
    email: 'tecnico@example.com',
    role: 'technician',
    fullName: 'Carlos',
  };

  it('devuelve el usuario solo si hay sesión y perfil guardados', async () => {
    expect(await getStoredUser()).toBeNull();

    mockStore.set(SECURE_KEYS.userProfile, JSON.stringify(profile));
    expect(await getStoredUser()).toBeNull();

    mockStore.set(SECURE_KEYS.authSession, '{"access_token":"x"}');
    expect(await getStoredUser()).toMatchObject({ id: 'u1', fullName: 'Carlos' });
  });

  it.each([
    ['el servidor responde', undefined],
    ['el servidor devuelve error', { message: 'sin red' }],
    ['la llamada lanza una excepción', new TypeError('Network request failed')],
  ])('signOut borra la sesión local cuando %s', async (_caso, signOutError) => {
    mockStore.set(SECURE_KEYS.authSession, '{"access_token":"x"}');
    mockStore.set(SECURE_KEYS.userProfile, JSON.stringify(profile));
    mockStore.set(SECURE_KEYS.userId, 'u1');
    const { client } = createSupabase({ signOutError });

    await expect(signOut(client)).resolves.toBeUndefined();

    expect(mockStore.size).toBe(0);
    expect(await getStoredUser()).toBeNull();
  });
});

describe('onSessionEnded', () => {
  it('avisa solo cuando la sesión termina y permite cancelar', () => {
    const { client, emit, unsubscribe } = createSupabase();
    const listener = jest.fn();

    const cancel = onSessionEnded(listener, client);
    emit('TOKEN_REFRESHED');
    emit('SIGNED_IN');
    expect(listener).not.toHaveBeenCalled();

    emit('SIGNED_OUT');
    expect(listener).toHaveBeenCalledTimes(1);

    cancel();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
