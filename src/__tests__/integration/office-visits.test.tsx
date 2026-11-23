import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text } from 'react-native';

import HomeScreen from '@/app/(app)/home';
import VisitsListScreen from '@/app/(app)/visits';
import VisitDetailScreen from '@/app/(app)/visits/[visitId]';
import VisitMaterialsScreen from '@/app/(app)/visits/[visitId]/materials';
import VisitSummaryScreen from '@/app/(app)/visits/[visitId]/summary';
import type { UserProfile } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';
import { resetFakeRouter, useCurrentRoute } from '@/test-utils/fake-router';
import { TECH_A, TECH_B, visitMaterialRow, visitRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

/**
 * Administración y oficina reciben TODAS las visitas (stream
 * visitas_de_oficina): las ven en el inicio y en «Visitas», con el técnico
 * de cada una. Las de otro técnico son de solo lectura (la RLS solo deja
 * escribir sus filas hijas a su técnico). El técnico sigue viendo solo las suyas.
 */

jest.mock('expo-router', () => jest.requireActual('@/test-utils/fake-router'));
jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined), fetch: jest.fn() },
}));

const SCREENS: Record<string, ComponentType> = {
  '/home': HomeScreen,
  '/visits': VisitsListScreen,
  '/visits/[visitId]': VisitDetailScreen,
  '/visits/[visitId]/materials': VisitMaterialsScreen,
  '/visits/[visitId]/summary': VisitSummaryScreen,
};

function Navigator() {
  const route = useCurrentRoute();
  const Screen = SCREENS[route.pathname];
  if (!Screen) return <Text>{`Ruta no montada: ${route.pathname}`}</Text>;
  return <Screen key={`${route.pathname}:${JSON.stringify(route.params)}`} />;
}

function App() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false, gcTime: Infinity },
      queries: { gcTime: Infinity },
    },
  });
  return (
    <QueryClientProvider client={client}>
      <Navigator />
    </QueryClientProvider>
  );
}

const OFFICE_ID = 'oficina-1';

const profile = (id: string, role: UserProfile['role']): UserProfile => ({
  id,
  email: `${id}@teins.com`,
  role,
  fullName: null,
  phone: null,
  avatarUrl: null,
});

let db: TestDatabase;
let foreign: Row;

function signIn(user: UserProfile) {
  useAuthStore.setState({
    status: 'authenticated',
    user,
    isDemoMode: false,
    isSubmitting: false,
    error: null,
  });
}

beforeEach(() => {
  db = createTestDatabase();
  db.insert('profiles', [
    { id: TECH_A, full_name: 'Ana Pérez', email: 'ana@teins.com', role: 'technician' },
    { id: TECH_B, full_name: 'Luis Gómez', email: 'luis@teins.com', role: 'technician' },
  ]);
  foreign = visitRow({
    id: 'v-luis',
    technician_id: TECH_B,
    title: 'Revisión UPS',
    client_name: 'Banco Sur',
    status: 'inProgress',
    started_at: '2026-06-01T09:00:00.000Z',
    created_at: '2026-06-01T08:00:00.000Z',
  });
  db.insert('visits', [
    visitRow({ id: 'v-ana', technician_id: TECH_A, title: 'Tablero', client_name: 'Colegio' }),
    foreign,
  ]);
  db.insert('visit_materials', [
    visitMaterialRow({ id: 'vm-luis', visit_id: 'v-luis', material_name: 'Cable UTP' }),
  ]);
  setTestDatabase(db);
});

afterEach(() => {
  setTestDatabase(null);
  useAuthStore.setState({ status: 'unauthenticated', user: null, isDemoMode: false });
});

it('oficina: inicio y «Visitas» con las de todos los técnicos y su nombre', async () => {
  signIn(profile(OFFICE_ID, 'office'));
  resetFakeRouter('/home');
  await render(<App />);

  expect(screen.getByLabelText('Asignadas: 1')).toBeOnTheScreen();
  expect(screen.getByLabelText('En progreso: 1')).toBeOnTheScreen();
  expect(screen.getByTestId('home-all-visits')).toBeOnTheScreen();
  expect(screen.getByText(/Técnico: Luis Gómez/)).toBeOnTheScreen();

  await act(async () => resetFakeRouter('/visits'));
  expect(screen.getByText('Visitas')).toBeOnTheScreen();
  const ana = screen.getByTestId('visit-card-v-ana');
  const luis = screen.getByTestId('visit-card-v-luis');
  expect(within(ana).getByText('Técnico: Ana Pérez')).toBeOnTheScreen();
  expect(within(luis).getByText('Técnico: Luis Gómez')).toBeOnTheScreen();
});

it('admin: la visita de otro técnico se consulta (PDF incluido) pero no se edita', async () => {
  signIn(profile(OFFICE_ID, 'admin'));
  resetFakeRouter({ pathname: '/visits/[visitId]', params: { visitId: 'v-luis' } });
  await render(<App />);

  expect(screen.getByTestId('visit-owner')).toHaveTextContent('Visita de Luis Gómez');
  expect(
    screen.getByText(
      'Visita de Luis Gómez: puedes consultarla, pero solo su técnico puede editarla.',
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Finalizar visita' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Iniciar visita' })).toBeNull();
  expect(screen.getByRole('button', { name: /informe PDF de la visita/ })).toBeOnTheScreen();

  await act(async () =>
    resetFakeRouter({ pathname: '/visits/[visitId]/materials', params: { visitId: 'v-luis' } }),
  );
  expect(await screen.findByText('Cable UTP')).toBeOnTheScreen();
  expect(screen.getByText(/Visita de Luis Gómez: puedes consultarla/)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Agregar material/ })).toBeNull();

  await act(async () =>
    resetFakeRouter({ pathname: '/visits/[visitId]/summary', params: { visitId: 'v-luis' } }),
  );
  expect(screen.getByTestId('visit-owner')).toHaveTextContent('Visita de Luis Gómez');
  expect(db.rows('visits').find((row) => row.id === 'v-luis')).toEqual(foreign);
});

it('técnico: sigue viendo solo sus visitas; la ajena no se encuentra', async () => {
  signIn(profile(TECH_A, 'technician'));
  resetFakeRouter('/visits');
  await render(<App />);
  expect(screen.getByText('Mis visitas')).toBeOnTheScreen();
  expect(screen.getByTestId('visit-card-v-ana')).toBeOnTheScreen();
  expect(screen.queryByTestId('visit-card-v-luis')).toBeNull();
  expect(screen.queryByText(/Técnico:/)).toBeNull();

  await act(async () =>
    resetFakeRouter({ pathname: '/visits/[visitId]', params: { visitId: 'v-luis' } }),
  );
  expect(
    await screen.findByText('No se encontró la visita. Es posible que ya no esté asignada a ti.'),
  ).toBeOnTheScreen();

  // Su propia visita: editable, con las acciones de siempre y sin aviso de dueño.
  await act(async () =>
    resetFakeRouter({ pathname: '/visits/[visitId]', params: { visitId: 'v-ana' } }),
  );
  expect(screen.getByRole('button', { name: 'Iniciar visita' })).toBeOnTheScreen();
  expect(screen.queryByTestId('visit-owner')).toBeNull();
});
