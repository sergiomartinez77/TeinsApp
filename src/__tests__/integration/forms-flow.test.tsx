import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text } from 'react-native';

import VisitFormScreen from '@/app/(app)/visits/[visitId]/form';
import FormSelectScreen from '@/app/(app)/visits/[visitId]/form-select';
import { DEMO_USER } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';
import { currentRoute, resetFakeRouter, router, useCurrentRoute } from '@/test-utils/fake-router';
import { responseRow, templateRow, visitRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

/**
 * Varios formularios en la misma visita, con las pantallas reales sobre
 * SQLite: lista vacía → agregar → llenar → volver (autoguardado) → la lista
 * muestra el progreso → agregar otro (la plantilla usada ya no se ofrece) →
 * una respuesta antigua aparece con su plantilla resuelta.
 */

jest.mock('expo-router', () => jest.requireActual('@/test-utils/fake-router'));
jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined), fetch: jest.fn() },
}));
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: View, DateTimePickerAndroid: { open: jest.fn() } };
});

const SCREENS: Record<string, ComponentType> = {
  '/visits/[visitId]/form-select': FormSelectScreen,
  '/visits/[visitId]/form': VisitFormScreen,
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

let db: TestDatabase;

beforeEach(() => {
  resetIds('id');
  db = createTestDatabase();
  db.insert('visits', [
    visitRow({ id: 'v1', technician_id: DEMO_USER.id, status: 'inProgress' }),
    visitRow({ id: 'v-cerrada', technician_id: DEMO_USER.id, status: 'completed' }),
  ]);
  db.insert('form_templates', [
    templateRow({ id: 'tpl-db-1', name: 'Plantilla de la base' }),
    templateRow({ id: 'tpl-db-2', name: 'Revisión eléctrica', visit_type: 'energia', version: 1 }),
  ]);
  setTestDatabase(db);
  useAuthStore.setState({
    status: 'authenticated',
    user: DEMO_USER,
    isDemoMode: true,
    isSubmitting: false,
    error: null,
  });
});

afterEach(() => {
  setTestDatabase(null);
  useAuthStore.setState({ status: 'unauthenticated', user: null, isDemoMode: false });
});

const openList = (visitId = 'v1') =>
  resetFakeRouter({ pathname: '/visits/[visitId]/form-select', params: { visitId } });

it('agrega dos formularios a la visita y no pierde lo escrito al cambiar de uno a otro', async () => {
  openList();
  await render(<App />);

  expect(screen.getByText('Sin formularios')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('add-form'));
  expect(currentRoute().params).toMatchObject({ visitId: 'v1', mode: 'add' });

  // Las recomendadas (tipo de la visita) primero.
  expect(screen.getByLabelText(/^Plantilla de la base, .*recomendado$/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('template-tpl-db-1'));
  expect(currentRoute()).toMatchObject({
    pathname: '/visits/[visitId]/form',
    params: { visitId: 'v1', templateId: 'tpl-db-1' },
  });

  await fireEvent.changeText(
    await screen.findByLabelText('Observación, obligatorio'),
    'Tablero revisado',
  );
  // Salir del formulario (volver a la lista) guarda lo pendiente.
  await act(async () => router.back());
  await waitFor(() => expect(db.rows('form_responses')).toHaveLength(1));
  expect(db.rows('form_responses')[0]).toMatchObject({
    template_key: 'tpl-db-1',
    is_complete: 0,
  });

  expect(
    await screen.findByLabelText('Plantilla de la base, En curso, 1 de 1 campo obligatorio'),
  ).toBeOnTheScreen();

  // Segundo formulario: la plantilla ya usada no se vuelve a ofrecer.
  await fireEvent.press(screen.getByTestId('add-form'));
  expect(screen.queryByTestId('template-tpl-db-1')).toBeNull();
  await fireEvent.press(screen.getByTestId('template-tpl-db-2'));
  await fireEvent.changeText(await screen.findByLabelText('Observación, obligatorio'), 'Otro');
  await act(async () => router.back());
  await waitFor(() => expect(db.rows('form_responses')).toHaveLength(2));

  // Volver al primero: conserva lo escrito.
  await fireEvent.press(
    await screen.findByLabelText('Plantilla de la base, En curso, 1 de 1 campo obligatorio'),
  );
  expect(currentRoute().params).toMatchObject({ responseId: 'id-1', templateId: 'tpl-db-1' });
  expect(await screen.findByDisplayValue('Tablero revisado')).toBeOnTheScreen();

  // Solo el primer formulario quedó registrado en la visita.
  const visit = await db.get<Row>('SELECT * FROM visits WHERE id = ?', ['v1']);
  expect(visit.form_template_id).toBe('tpl-db-1');
});

it('una respuesta antigua aparece en la lista con su plantilla resuelta y se abre', async () => {
  db.insert('form_responses', [
    responseRow({
      id: 'r-antigua',
      visit_id: 'v1',
      template_id: 'tpl-db-1',
      responses: JSON.stringify({ f1: 'De antes' }),
      is_complete: 1,
      completed_at: '2026-06-01T10:00:00.000Z',
    }),
  ]);
  openList();
  await render(<App />);

  await fireEvent.press(
    screen.getByLabelText('Plantilla de la base, Completado, 1 de 1 campo obligatorio'),
  );
  expect(await screen.findByDisplayValue('De antes')).toBeOnTheScreen();
  expect(screen.getByText('Formulario completado')).toBeOnTheScreen();
});

it('visita cerrada: sin botón para agregar y aviso si no tiene formularios', async () => {
  openList('v-cerrada');
  await render(<App />);
  expect(screen.getByText('La visita está cerrada')).toBeOnTheScreen();
  expect(screen.queryByTestId('add-form')).toBeNull();
});
