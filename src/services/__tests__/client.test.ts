import { AppState, type AppStateStatus } from 'react-native';

/**
 * Cliente de Supabase: creación diferida, error si falta configuración y
 * refresco del token solo en primer plano. `createClient` y la configuración
 * de Expo se simulan (no hay red).
 */

const mockCreateClient = jest.fn((url: string, key: string, options: unknown) => ({
  url,
  key,
  options,
  auth: {
    startAutoRefresh: jest.fn(async () => undefined),
    stopAutoRefresh: jest.fn(async () => undefined),
  },
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: unknown) => mockCreateClient(url, key, options),
}));
jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

let mockExtra: Record<string, string> = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

type ClientModule = typeof import('../supabase/client');

/** Carga el módulo desde cero (la configuración se lee al importarlo). */
function loadClient(extra: Record<string, string>): ClientModule {
  mockExtra = extra;
  let loaded: ClientModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<ClientModule>('../supabase/client');
  });
  if (!loaded) throw new Error('no se cargó el cliente');
  return loaded;
}

const FULL = {
  supabaseUrl: 'https://supabase.test',
  supabaseAnonKey: 'clave-publica',
  powerSyncUrl: 'https://powersync.test',
};

beforeEach(() => {
  mockCreateClient.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getSupabase', () => {
  it('crea el cliente al pedirlo por primera vez y luego lo reutiliza', () => {
    const { getSupabase } = loadClient(FULL);
    expect(mockCreateClient).not.toHaveBeenCalled();

    const client = getSupabase();
    expect(getSupabase()).toBe(client);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://supabase.test',
      'clave-publica',
      expect.objectContaining({
        auth: expect.objectContaining({
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'auth_token',
        }),
      }),
    );
  });

  it('falla con un mensaje claro si falta configuración', () => {
    const { getSupabase } = loadClient({ supabaseUrl: 'https://supabase.test' });
    expect(() => getSupabase()).toThrow(
      'Configuración incompleta: SUPABASE_ANON_KEY, POWERSYNC_URL',
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

describe('registerAuthAutoRefresh', () => {
  function setup(initial: AppStateStatus) {
    const { getSupabase, registerAuthAutoRefresh } = loadClient(FULL);
    const supabase = getSupabase();
    let listener: ((status: AppStateStatus) => void) | null = null;
    const remove = jest.fn();
    Object.defineProperty(AppState, 'currentState', { value: initial, configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler as (status: AppStateStatus) => void;
      return { remove };
    });
    const stop = registerAuthAutoRefresh(supabase);
    return { supabase, stop, remove, emit: (status: AppStateStatus) => listener?.(status) };
  }

  it('refresca en primer plano y se detiene en segundo plano', () => {
    const { supabase, emit } = setup('active');
    expect(supabase.auth.startAutoRefresh).toHaveBeenCalledTimes(1);

    emit('background');
    expect(supabase.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    emit('active');
    expect(supabase.auth.startAutoRefresh).toHaveBeenCalledTimes(2);
  });

  it('arranca detenido si la app no está activa y al cancelar deja de escuchar', () => {
    const { supabase, stop, remove } = setup('background');
    expect(supabase.auth.startAutoRefresh).not.toHaveBeenCalled();
    expect(supabase.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);

    stop();
    expect(remove).toHaveBeenCalled();
    expect(supabase.auth.stopAutoRefresh).toHaveBeenCalledTimes(2);
  });

  it('un fallo al cambiar el refresco no rompe la app', async () => {
    const { supabase, emit } = setup('background');
    jest.mocked(supabase.auth.startAutoRefresh).mockRejectedValueOnce(new Error('sin red'));
    expect(() => emit('active')).not.toThrow();
    await Promise.resolve();
  });
});
