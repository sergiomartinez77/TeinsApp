import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import AppLayout from '@/app/(app)/_layout';
import HomeScreen from '@/app/(app)/home';
import AuthLayout from '@/app/(auth)/_layout';
import LoginScreen from '@/app/(auth)/login';
import StartupScreen from '@/app/index';
import RootLayout from '@/app/_layout';
import { SECURE_KEYS } from '@/constants/app.constants';
import { AUTH_MESSAGES } from '@/services/supabase/auth.service';
import { useAuthStore } from '@/store/auth.store';
import { useSyncStore } from '@/store/sync.store';
import { currentRoute, registerRoutes, resetFakeRouter } from '@/test-utils/fake-router';
import { visitRow } from '@/test-utils/fixtures';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

/**
 * Flujo de sesión con los layouts y pantallas reales, la base SQLite real y
 * un Supabase falso: arranque sin sesión → login fallido → login correcto →
 * la base se abre y arranca el monitor → cerrar sesión libera la base.
 * Y el modo demo: siembra los datos y al salir los borra.
 *
 * Se simula solo lo nativo o externo: navegación, almacenamiento seguro,
 * configuración de Expo, red, el cliente HTTP de Supabase y el constructor
 * nativo de PowerSync (que devuelve la base de test). `database.ts`,
 * `session-database.ts`, `DatabaseProvider`, el store y los servicios son reales.
 */

const TECH_ID = '11111111-1111-4111-8111-111111111111';
const PASSWORD_OK = 'clave-correcta';

jest.mock('expo-router', () => jest.requireActual('@/test-utils/fake-router'));
jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined), fetch: jest.fn() },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        supabaseUrl: 'https://supabase.test',
        supabaseAnonKey: 'clave-publica-de-prueba',
        powerSyncUrl: 'https://powersync.test',
        logLevel: 'none',
      },
    },
  },
}));

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecure.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecure.delete(key);
  }),
}));

// ── Supabase falso (sin red) ──
const mockAuth = {
  signInWithPassword: jest.fn(async ({ email, password }: { email: string; password: string }) =>
    password === 'clave-correcta'
      ? {
          data: { user: { id: '11111111-1111-4111-8111-111111111111', email }, session: {} },
          error: null,
        }
      : {
          data: { user: null, session: null },
          error: { name: 'AuthApiError', message: 'Invalid login credentials', status: 400 },
        },
  ),
  signOut: jest.fn(async () => ({ error: null })),
  startAutoRefresh: jest.fn(async () => undefined),
  stopAutoRefresh: jest.fn(async () => undefined),
  onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
  getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
};
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: mockAuth,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: '11111111-1111-4111-8111-111111111111',
              email: 'ana@teins.test',
              full_name: 'Ana Pérez',
              role: 'technician',
            },
            error: null,
          }),
        }),
      }),
    }),
    storage: { from: () => ({ upload: jest.fn(), createSignedUrl: jest.fn() }) },
  })),
}));

// ── PowerSync nativo → base SQLite de test ──
const mockDatabases = new Map<string, TestDatabase>();
jest.mock('@powersync/op-sqlite', () => ({
  OPSqliteOpenFactory: jest.fn((options: { dbFilename: string }) => options),
}));
jest.mock('@powersync/react-native', () => ({
  ...jest.requireActual<object>('@powersync/common'),
  PowerSyncDatabase: jest.fn((options: { database: { dbFilename: string } }) => {
    const db = mockDatabases.get(options.database.dbFilename);
    if (!db) throw new Error(`Base no preparada: ${options.database.dbFilename}`);
    return Object.assign(db, { init: async () => undefined });
  }),
}));

let main: TestDatabase;
let demo: TestDatabase;

beforeEach(() => {
  jest.clearAllMocks();
  mockSecure.clear();
  main = createTestDatabase();
  demo = createTestDatabase();
  main.insert('visits', [visitRow({ id: 'propia', technician_id: TECH_ID, status: 'assigned' })]);
  mockDatabases.set('teins_local.db', main);
  mockDatabases.set('teins_demo.db', demo);

  registerRoutes({
    '/': { screen: StartupScreen },
    '/login': { layout: AuthLayout, screen: LoginScreen },
    '/home': { layout: AppLayout, screen: HomeScreen },
  });
  resetFakeRouter('/');
  useAuthStore.setState({
    status: 'checking',
    user: null,
    isDemoMode: false,
    isSubmitting: false,
    error: null,
  });
  // Confirma el diálogo de cerrar sesión pulsando la acción destructiva.
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function signIn(password: string) {
  await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'Ana@Teins.test');
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), password);
  await fireEvent.press(screen.getByTestId('login-submit'));
}

it('sin sesión → login fallido → login correcto → base abierta → cerrar sesión la libera', async () => {
  await render(<RootLayout />);

  // checkSession no encuentra sesión guardada: va al login.
  expect(await screen.findByTestId('login-submit')).toBeOnTheScreen();
  expect(useAuthStore.getState().status).toBe('unauthenticated');
  expect(currentRoute().pathname).toBe('/login');

  // Login fallido: mensaje en español, sin abrir la base.
  await signIn('incorrecta');
  expect(await screen.findByText(AUTH_MESSAGES.invalidCredentials)).toBeOnTheScreen();
  expect(main.events).toEqual([]);

  // Login correcto: perfil guardado, base principal abierta y conectada.
  await signIn(PASSWORD_OK);
  expect(await screen.findByLabelText('Asignadas: 1')).toBeOnTheScreen();
  expect(currentRoute().pathname).toBe('/home');
  expect(screen.getByRole('header', { name: /, Ana$/ })).toBeOnTheScreen();
  expect(mockAuth.signInWithPassword).toHaveBeenLastCalledWith({
    email: 'ana@teins.test',
    password: PASSWORD_OK,
  });
  expect(JSON.parse(mockSecure.get(`${SECURE_KEYS.userProfile}.0`) ?? '{}')).toMatchObject({
    id: TECH_ID,
    fullName: 'Ana Pérez',
  });
  await waitFor(() => expect(main.events).toContain('connect'));
  expect(mockSecure.get(`${SECURE_KEYS.databaseOwner}.0`)).toBe(TECH_ID);

  // El monitor de sincronización publica en el store (sin conexión al servidor).
  await act(async () => {
    main.setStatus({ connected: true, lastSyncedAt: new Date('2026-06-10T12:00:00.000Z') });
  });
  await waitFor(() =>
    expect(useSyncStore.getState().lastSyncedAt).toBe('2026-06-10T12:00:00.000Z'),
  );

  // Cerrar sesión: vuelve al login y la base se cierra CONSERVANDO los datos.
  await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
  expect(await screen.findByTestId('login-submit')).toBeOnTheScreen();
  await waitFor(() => expect(main.closed).toBe(true));
  expect(main.events).toEqual(['connect', 'disconnect', 'close']);
  expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  expect(mockSecure.has(`${SECURE_KEYS.userProfile}.0`)).toBe(false);
});

it('modo demo: siembra los datos de ejemplo y al salir los borra', async () => {
  await render(<RootLayout />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Continuar en modo demo' }));

  expect(await screen.findByLabelText('Asignadas: 2')).toBeOnTheScreen();
  expect(screen.getByLabelText('En progreso: 1')).toBeOnTheScreen();
  expect(demo.rows('visits')).toHaveLength(3);
  expect(demo.rows('material_catalog')).toHaveLength(14);
  // La base demo nunca se conecta y la principal ni se abre.
  expect(demo.events).toEqual(['clear']);
  expect(main.events).toEqual([]);

  await act(async () => {
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
  });
  expect(await screen.findByTestId('login-submit')).toBeOnTheScreen();
  await waitFor(() => expect(demo.closed).toBe(true));
  // Al salir se vacía (clear) y se cierra; el servidor no se toca.
  expect(demo.events).toEqual(['clear', 'clear', 'close']);
  expect(mockAuth.signOut).not.toHaveBeenCalled();
});
