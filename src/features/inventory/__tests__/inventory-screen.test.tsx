import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import InventoryScreen from '@/app/(app)/inventory';
import type { UserProfile } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';
import { useSyncStore } from '@/store/sync.store';
import { resetFakeRouter } from '@/test-utils/fake-router';
import { catalogRow, materialStockRow, stockMovementRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

import { INVENTORY_MESSAGES } from '../validation';

/**
 * Pantalla de inventario sobre SQLite real: lista, búsqueda, filtro,
 * "Qué comprar", detalle y acciones según el rol. Solo se simula lo nativo
 * (navegación, red e ids).
 */

jest.mock('expo-router', () => jest.requireActual('@/test-utils/fake-router'));
jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined), fetch: jest.fn() },
}));

const user = (role: UserProfile['role']): UserProfile => ({
  id: `usuario-${role}`,
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
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false, gcTime: Infinity },
      queries: { gcTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <InventoryScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  resetIds('mv');
  resetFakeRouter('/inventory');
  db = createTestDatabase();
  db.insert('material_catalog', [
    catalogRow({ id: 'm-cable', code: 'CAB-01', name: 'Cable UTP', unit: 'metro', min_stock: 100 }),
    catalogRow({ id: 'm-breaker', code: 'BRK-20', name: 'Breaker 20A', min_stock: 5 }),
    catalogRow({ id: 'm-nuevo', code: 'NEW-01', name: 'Conector nuevo', min_stock: null }),
  ]);
  db.insert('material_stock', [
    materialStockRow({ material_id: 'm-cable', purchased: 120, used: 70.5, on_hand: 49.5 }),
    materialStockRow({ material_id: 'm-breaker', purchased: 10, adjusted: -1, on_hand: 9 }),
  ]);
  db.insert('material_stock_movements', [
    stockMovementRow({ id: 'mv-old', material_id: 'm-breaker', quantity: 10, note: 'Factura 7' }),
  ]);
  setTestDatabase(db);
});

afterEach(() => {
  jest.useRealTimers();
  setTestDatabase(null);
  useSyncStore.getState().reset();
  useAuthStore.setState({ status: 'unauthenticated', user: null, isDemoMode: false });
});

const tiles = () =>
  screen
    .queryAllByTestId(/^stock-/)
    .map((node) => String(node.props.accessibilityLabel).split(',')[0]);

it('técnico: lista con bajo mínimo primero, "Qué comprar" y solo consulta', async () => {
  await renderScreen('technician');

  expect(tiles()).toEqual(['Cable UTP', 'Breaker 20A', 'Conector nuevo']);
  expect(screen.getByText(/Consulta de existencias/)).toBeOnTheScreen();
  const cable = screen.getByTestId('stock-m-cable');
  expect(within(cable).getByText('Bajo mínimo')).toBeOnTheScreen();
  expect(within(cable).getByText('49,5 metro')).toBeOnTheScreen();
  expect(
    within(screen.getByTestId('stock-m-nuevo')).getByText(/Sin datos de bodega/),
  ).toBeOnTheScreen();

  const buy = screen.getByTestId('purchase-suggestions');
  expect(
    within(buy).getByText('Comprar 51 metro (hay 49,5 metro; mínimo 100 metro)'),
  ).toBeOnTheScreen();

  // Detalle: sin botones de compra, ajuste ni mínimo.
  await fireEvent.press(cable);
  const detail = screen.getByTestId('material-stock-dialog');
  expect(within(detail).getByText('Usado en visitas')).toBeOnTheScreen();
  expect(within(detail).getByText('70,5 metro')).toBeOnTheScreen();
  expect(within(detail).getByText('Sin compras ni ajustes registrados.')).toBeOnTheScreen();
  expect(within(detail).queryByRole('button', { name: 'Registrar compra' })).toBeNull();
  expect(within(detail).queryByRole('button', { name: 'Ajuste' })).toBeNull();
  expect(within(detail).queryByRole('button', { name: 'Mínimo' })).toBeNull();
  await fireEvent.press(within(detail).getByRole('button', { name: 'Cerrar' }));
  expect(screen.queryByTestId('material-stock-dialog')).toBeNull();
});

it('busca y filtra solo los bajo mínimo', async () => {
  await renderScreen('technician');

  await fireEvent.changeText(screen.getByLabelText('Buscar material'), 'brk');
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(tiles()).toEqual(['Breaker 20A']);

  await fireEvent.changeText(screen.getByLabelText('Buscar material'), '');
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Solo bajo mínimo' }));
  expect(tiles()).toEqual(['Cable UTP']);

  await fireEvent.changeText(screen.getByLabelText('Buscar material'), 'conector');
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(tiles()).toEqual([]);
  expect(screen.getByText('Ningún material coincide')).toBeOnTheScreen();
});

it('oficina registra una compra: queda pendiente sin cambiar las existencias', async () => {
  await renderScreen('office');

  expect(screen.queryByText(/Consulta de existencias/)).toBeNull();
  await fireEvent.press(screen.getByTestId('stock-m-breaker'));
  const detail = screen.getByTestId('material-stock-dialog');
  expect(within(detail).getByText('Factura 7')).toBeOnTheScreen();
  expect(within(detail).queryByRole('button', { name: 'Mínimo' })).toBeNull();

  await fireEvent.press(within(detail).getByRole('button', { name: 'Registrar compra' }));
  const form = screen.getByTestId('stock-movement-dialog');
  await fireEvent.press(within(form).getByRole('button', { name: 'Registrar compra' }));
  expect(await within(form).findByText(INVENTORY_MESSAGES.quantityRequired)).toBeOnTheScreen();

  await fireEvent.changeText(within(form).getByLabelText('Cantidad, obligatorio'), '4');
  await fireEvent.changeText(within(form).getByLabelText('Nota'), 'Proveedor X');
  await fireEvent.press(within(form).getByRole('button', { name: 'Registrar compra' }));

  await waitFor(() => expect(screen.queryByTestId('stock-movement-dialog')).toBeNull());
  expect(db.rows('material_stock_movements').find((row) => row.id === 'mv-1')).toMatchObject({
    material_id: 'm-breaker',
    kind: 'purchase',
    quantity: 4,
    note: 'Proveedor X',
    created_by: 'usuario-office',
    sync_status: 'pendingSync',
  });

  // Vuelve al detalle: el movimiento aparece como pendiente y las existencias siguen en 9.
  const again = await screen.findByTestId('material-stock-dialog');
  expect(within(again).getByTestId('movement-mv-1')).toBeOnTheScreen();
  expect(within(again).getByText(/aún no llegan al servidor/)).toBeOnTheScreen();
  expect(within(again).getByText('9 unidad')).toBeOnTheScreen();
  await fireEvent.press(within(again).getByRole('button', { name: 'Cerrar' }));

  expect(screen.getByTestId('inventory-pending')).toBeOnTheScreen();
  expect(
    within(screen.getByTestId('stock-m-breaker')).getByText('Pendiente de sincronizar'),
  ).toBeOnTheScreen();
});

it('oficina registra un ajuste negativo y puede cancelar', async () => {
  await renderScreen('office');

  await fireEvent.press(screen.getByTestId('stock-m-cable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Ajuste' }));
  let form = screen.getByTestId('stock-movement-dialog');
  expect(within(form).getByText('Ajuste de inventario')).toBeOnTheScreen();
  await fireEvent.press(within(form).getByRole('button', { name: 'Cancelar' }));
  expect(screen.getByTestId('material-stock-dialog')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'Ajuste' }));
  form = screen.getByTestId('stock-movement-dialog');
  await fireEvent.changeText(within(form).getByLabelText('Cantidad, obligatorio'), '0');
  await fireEvent.press(within(form).getByRole('button', { name: 'Guardar ajuste' }));
  expect(await within(form).findByText(INVENTORY_MESSAGES.adjustmentNonZero)).toBeOnTheScreen();

  await fireEvent.changeText(within(form).getByLabelText('Cantidad, obligatorio'), '-2,5');
  await fireEvent.press(within(form).getByRole('button', { name: 'Guardar ajuste' }));
  await waitFor(() => expect(screen.queryByTestId('stock-movement-dialog')).toBeNull());
  expect(db.rows('material_stock_movements').find((row) => row.id === 'mv-1')).toMatchObject({
    kind: 'adjustment',
    quantity: -2.5,
  });
  expect(within(screen.getByTestId('movement-mv-1')).getByText('−2,5 metro')).toBeOnTheScreen();
});

it('admin cambia el mínimo y el material entra en "Qué comprar"', async () => {
  await renderScreen('admin');

  expect(within(screen.getByTestId('purchase-suggestions')).queryByText('Breaker 20A')).toBeNull();
  await fireEvent.press(screen.getByTestId('stock-m-breaker'));
  await fireEvent.press(screen.getByRole('button', { name: 'Mínimo' }));
  const form = screen.getByTestId('min-stock-dialog');
  await fireEvent.changeText(within(form).getByLabelText('Mínimo'), '-1');
  await fireEvent.press(within(form).getByRole('button', { name: 'Guardar' }));
  expect(await within(form).findByText(INVENTORY_MESSAGES.minStockNegative)).toBeOnTheScreen();

  await fireEvent.changeText(within(form).getByLabelText('Mínimo'), '12');
  await fireEvent.press(within(form).getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(screen.queryByTestId('min-stock-dialog')).toBeNull());

  expect(db.rows('material_catalog').find((row) => row.id === 'm-breaker')?.min_stock).toBe(12);
  await fireEvent.press(
    within(screen.getByTestId('material-stock-dialog')).getByRole('button', { name: 'Cerrar' }),
  );
  expect(
    within(screen.getByTestId('purchase-suggestions')).getByText(
      'Comprar 3 unidad (hay 9 unidad; mínimo 12 unidad)',
    ),
  ).toBeOnTheScreen();
});

it('sin materiales bajo mínimo, "Qué comprar" lo dice; los cambios pendientes globales se avisan', async () => {
  db.raw.exec('UPDATE material_catalog SET min_stock = NULL');
  useSyncStore.getState().setSnapshot({ state: 'pending', pendingCount: 2, lastSyncedAt: null });
  await renderScreen('technician');

  expect(screen.getByText(/Nada por comprar/)).toBeOnTheScreen();
  expect(screen.getByTestId('inventory-pending')).toBeOnTheScreen();
});
