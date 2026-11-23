import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import InventoryScreen from '@/app/(app)/inventory';
import type { UserProfile } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';
import { useSyncStore } from '@/store/sync.store';
import { currentRoute, resetFakeRouter } from '@/test-utils/fake-router';
import {
  catalogRow,
  materialStockRow,
  TECH_B,
  visitMaterialRow,
  visitRow,
} from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

/**
 * Inventario: "Falta conteo inicial", "Stock negativo", el grupo "Sin conteo
 * inicial" de "Qué comprar" y "Uso por visita" en el detalle (SQLite real).
 */

jest.mock('expo-router', () => jest.requireActual('@/test-utils/fake-router'));
jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined), fetch: jest.fn() },
}));

const USER_ID = 'tecnico-a';

const user = (role: UserProfile['role']): UserProfile => ({
  id: USER_ID,
  email: `${role}@teins.com`,
  role,
  fullName: null,
  phone: null,
  avatarUrl: null,
});

let db: TestDatabase;

function renderScreen(role: UserProfile['role']) {
  useAuthStore.setState({
    status: 'authenticated',
    user: user(role),
    isDemoMode: false,
    isSubmitting: false,
    error: null,
  });
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <InventoryScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetFakeRouter('/inventory');
  db = createTestDatabase();
  db.insert('material_catalog', [
    catalogRow({ id: 'm-cable', code: 'CAB-01', name: 'Cable UTP', unit: 'metro', min_stock: 100 }),
    catalogRow({ id: 'm-tornillo', code: 'TOR-01', name: 'Tornillo', min_stock: null }),
  ]);
  db.insert('material_stock', [
    materialStockRow({ material_id: 'm-cable', used: 63, on_hand: -63 }),
    materialStockRow({ material_id: 'm-tornillo', purchased: 5, used: 8, on_hand: -3 }),
  ]);
  db.insert('profiles', [{ id: TECH_B, full_name: 'Luis Gómez', email: 'luis@teins.com' }]);
  db.insert('visits', [
    visitRow({
      id: 'v-perez',
      technician_id: USER_ID,
      title: 'Red',
      client_name: 'Pérez',
      status: 'completed',
      created_at: '2026-06-01T08:00:00.000Z',
      completed_at: '2026-06-02T10:00:00.000Z',
    }),
    visitRow({
      id: 'v-colegio',
      technician_id: TECH_B,
      title: 'Cableado',
      client_name: 'Colegio',
      status: 'inProgress',
      created_at: '2026-06-05T08:00:00.000Z',
    }),
  ]);
  db.insert('visit_materials', [
    visitMaterialRow({
      id: 'a',
      visit_id: 'v-perez',
      material_id: 'm-cable',
      unit: 'metro',
      quantity: 40,
    }),
    visitMaterialRow({
      id: 'b',
      visit_id: 'v-colegio',
      material_id: 'm-cable',
      unit: 'metro',
      quantity: 23,
    }),
  ]);
  setTestDatabase(db);
});

afterEach(() => {
  setTestDatabase(null);
  useSyncStore.getState().reset();
  useAuthStore.setState({ status: 'unauthenticated', user: null, isDemoMode: false });
});

it('sin compras ni ajustes: "Falta conteo inicial" en vez de "-63 metro", y aparte en "Qué comprar"', async () => {
  await renderScreen('technician');

  const cable = screen.getByTestId('stock-m-cable');
  expect(within(cable).getByText('Falta conteo inicial')).toBeOnTheScreen();
  expect(within(cable).getByText('Usado en visitas: 63 metro')).toBeOnTheScreen();
  expect(within(cable).queryByText(/-63|−63/)).toBeNull();
  expect(within(cable).queryByText('Bajo mínimo')).toBeNull();

  // Con compras y negativo: se muestra el número y la marca de inconsistencia.
  const tornillo = screen.getByTestId('stock-m-tornillo');
  expect(within(tornillo).getByText('-3 unidad')).toBeOnTheScreen();
  expect(within(tornillo).getByText('Stock negativo: revisa el conteo')).toBeOnTheScreen();

  const buy = screen.getByTestId('purchase-suggestions');
  expect(within(buy).queryByText(/^Comprar /)).toBeNull();
  expect(
    within(buy).getByText('Ningún material con conteo inicial está por debajo de su mínimo.'),
  ).toBeOnTheScreen();
  const group = within(buy).getByTestId('purchase-uncounted');
  expect(within(group).getByText('Sin conteo inicial (1)')).toBeOnTheScreen();
  expect(within(group).getByText('Usado en visitas: 63 metro; mínimo 100 metro')).toBeOnTheScreen();

  // El técnico ve que falta el conteo, sin la indicación de registrar el ajuste.
  await fireEvent.press(within(group).getByRole('button', { name: /Cable UTP/ }));
  const detail = screen.getByTestId('material-stock-dialog');
  expect(within(detail).getByTestId('no-initial-count')).toBeOnTheScreen();
  expect(within(detail).getByText(/oficina debe registrar el conteo/)).toBeOnTheScreen();
  expect(within(detail).queryByText('Registra un ajuste con lo que hay en bodega.')).toBeNull();
});

it('admin/oficina: indicación de registrar un ajuste; negativo con movimientos', async () => {
  await renderScreen('office');
  await fireEvent.press(screen.getByTestId('stock-m-cable'));
  let detail = screen.getByTestId('material-stock-dialog');
  expect(
    within(detail).getByText('Registra un ajuste con lo que hay en bodega.'),
  ).toBeOnTheScreen();
  expect(within(detail).getByText('63 metro')).toBeOnTheScreen();
  await fireEvent.press(within(detail).getByRole('button', { name: 'Cerrar' }));

  await fireEvent.press(screen.getByTestId('stock-m-tornillo'));
  detail = screen.getByTestId('material-stock-dialog');
  expect(within(detail).getByText('Stock negativo: revisa el conteo')).toBeOnTheScreen();
  expect(within(detail).getByText(/Se usó más de lo que entró/)).toBeOnTheScreen();
});

it('"Uso por visita": total arriba, una fila por visita (la más reciente primero) y abre la visita', async () => {
  await renderScreen('admin');
  await fireEvent.press(screen.getByTestId('stock-m-cable'));
  const detail = screen.getByTestId('material-stock-dialog');

  const toggle = within(detail).getByTestId('material-usage-toggle');
  expect(within(toggle).getByText('Total: 63 metro en 2 visitas')).toBeOnTheScreen();
  expect(within(detail).queryByTestId('usage-v-perez')).toBeNull();

  await fireEvent.press(toggle);
  const rows = within(detail).getAllByTestId(/^usage-v-/);
  expect(rows.map((row) => row.props.testID)).toEqual(['usage-v-colegio', 'usage-v-perez']);
  // Cada visita por separado, nunca sumadas.
  expect(within(rows[0]!).getByText('23 metro')).toBeOnTheScreen();
  expect(within(rows[0]!).getByText(/Técnico: Luis Gómez/)).toBeOnTheScreen();
  expect(within(rows[1]!).getByText('40 metro')).toBeOnTheScreen();
  expect(within(rows[1]!).queryByText(/Técnico:/)).toBeNull();
  expect(within(rows[1]!).getByText(/Completada/)).toBeOnTheScreen();

  await fireEvent.press(rows[1]!);
  expect(currentRoute()).toEqual({ pathname: '/visits/[visitId]', params: { visitId: 'v-perez' } });
  expect(screen.queryByTestId('material-stock-dialog')).toBeNull();
});

it('"Uso por visita" sin visitas con ese material', async () => {
  await renderScreen('technician');
  await fireEvent.press(screen.getByTestId('stock-m-tornillo'));
  const detail = screen.getByTestId('material-stock-dialog');
  await fireEvent.press(within(detail).getByTestId('material-usage-toggle'));
  expect(within(detail).getByText('Total: 0 unidad en 0 visitas')).toBeOnTheScreen();
  expect(within(detail).getByText(/no se usó en las visitas guardadas/)).toBeOnTheScreen();
});
