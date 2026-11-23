import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text } from 'react-native';

import HomeScreen from '@/app/(app)/home';
import VisitsListScreen from '@/app/(app)/visits';
import VisitDetailScreen from '@/app/(app)/visits/[visitId]';
import VisitMaterialsScreen from '@/app/(app)/visits/[visitId]/materials';
import VisitSummaryScreen from '@/app/(app)/visits/[visitId]/summary';
import { seedDemoData } from '@/features/sync/demo-seed';
import { DEMO_USER } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';
import { currentRoute, resetFakeRouter, useCurrentRoute } from '@/test-utils/fake-router';
import { TECH_B, visitMaterialRow, visitRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

/**
 * Flujo de pantallas reales de `src/app/(app)` sobre SQLite real con los datos
 * del modo demo: dashboard → listado (pestañas y búsqueda) → crear visita →
 * detalle → iniciar → materiales (catálogo demo) → resumen.
 *
 * Solo se simula lo nativo: la navegación (pila en memoria), la red
 * (NetInfo) y los ids. Servicios, hooks, consultas y formularios son reales.
 * No se montan aquí las pantallas de anotaciones (Skia) ni el visor de fotos
 * (gestos nativos): ver docs/PRUEBAS_MANUALES.md.
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

/** Monta la pantalla de la ruta visible, como haría el navegador. */
function Navigator() {
  const route = useCurrentRoute();
  const Screen = SCREENS[route.pathname];
  if (!Screen) return <Text>{`Ruta no montada: ${route.pathname}`}</Text>;
  return <Screen key={`${route.pathname}:${JSON.stringify(route.params)}`} />;
}

function App() {
  // Sin temporizadores de recolección: si no, Jest no termina hasta 5 min después.
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

beforeEach(async () => {
  resetIds('nueva');
  db = createTestDatabase();
  await seedDemoData(db, DEMO_USER.id);
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

it('dashboard → listado → nueva visita → iniciar → materiales → resumen', async () => {
  resetFakeRouter('/home');
  await render(<App />);

  // ── Dashboard con los datos demo ──
  expect(screen.getByLabelText('Asignadas: 2')).toBeOnTheScreen();
  expect(screen.getByLabelText('En progreso: 1')).toBeOnTheScreen();
  expect(screen.getByLabelText('Completadas: 0')).toBeOnTheScreen();
  expect(
    screen.getByRole('button', {
      name: 'Abrir visita VT-00002 — Inspección Energía Planta Norte',
    }),
  ).toBeOnTheScreen();

  // ── Listado: pestañas y búsqueda ──
  await fireEvent.press(screen.getByRole('button', { name: 'Mis visitas' }));
  expect(currentRoute().pathname).toBe('/visits');
  const titles = () =>
    screen
      .queryAllByRole('button', { name: /^Abrir visita / })
      .map((node) => node.props.accessibilityLabel as string);
  expect(titles()).toEqual([
    'Abrir visita VT-00003 — Instalación Red Datos Oficinas Centrales',
    'Abrir visita VT-00002 — Inspección Energía Planta Norte',
    'Abrir visita VT-00001 — Inspección Infraestructura Almacén Sur',
  ]);

  await fireEvent.press(screen.getByRole('tab', { name: 'En progreso' }));
  expect(titles()).toEqual(['Abrir visita VT-00002 — Inspección Energía Planta Norte']);
  await fireEvent.press(screen.getByRole('tab', { name: 'Completadas' }));
  expect(screen.getByText('Aún no has completado visitas')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('tab', { name: 'Todas' }));

  await fireEvent.changeText(screen.getByLabelText('Buscar visitas'), 'CORPORACIÓN');
  expect(
    await screen.findByRole('button', {
      name: 'Abrir visita VT-00003 — Instalación Red Datos Oficinas Centrales',
    }),
  ).toBeOnTheScreen();
  await waitFor(() => expect(titles()).toHaveLength(1));
  await fireEvent.changeText(screen.getByLabelText('Buscar visitas'), 'no existe');
  expect(await screen.findByText('Sin resultados')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Borrar búsqueda' }));
  expect(await screen.findByRole('button', { name: /VT-00001/ })).toBeOnTheScreen();

  // ── Crear visita desde el diálogo: abre su detalle ──
  await fireEvent.press(screen.getByTestId('new-visit-fab'));
  await fireEvent.changeText(screen.getByLabelText('Título, obligatorio'), 'Revisión tablero');
  await fireEvent.changeText(screen.getByLabelText('Dirección'), 'Calle 10');
  await fireEvent.press(screen.getByRole('button', { name: 'Crear visita' }));

  expect(await screen.findByRole('header', { name: 'Revisión tablero' })).toBeOnTheScreen();
  expect(currentRoute()).toEqual({
    pathname: '/visits/[visitId]',
    params: { visitId: 'nueva-1' },
  });
  expect(db.rows('visits').find((row) => row.id === 'nueva-1')).toMatchObject({
    technician_id: DEMO_USER.id,
    status: 'assigned',
    address: 'Calle 10',
  });
  expect(screen.getByText('Asignada')).toBeOnTheScreen();

  // ── Iniciar visita: el estado cambia en pantalla sin recargar ──
  await fireEvent.press(screen.getByRole('button', { name: 'Iniciar visita' }));
  expect(await screen.findByText('En progreso')).toBeOnTheScreen();
  expect(screen.queryByText('Asignada')).toBeNull();
  expect(screen.getByRole('button', { name: 'Finalizar visita' })).toBeOnTheScreen();

  // ── Materiales: agregar uno del catálogo demo ──
  await fireEvent.press(screen.getByRole('button', { name: 'Materiales' }));
  expect(screen.getByText('Sin materiales registrados')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('add-material-fab'));
  const sheet = screen.getByTestId('add-material-sheet');
  await fireEvent.press(
    within(sheet).getByRole('button', { name: 'Cable UTP Cat6, código CABLE-UTP-CAT6' }),
  );
  await fireEvent.changeText(screen.getByLabelText('Cantidad, obligatorio'), '25');
  await fireEvent.press(screen.getByRole('button', { name: 'Agregar' }));

  await waitFor(() => expect(db.rows('visit_materials')).toHaveLength(1));
  expect(await screen.findByLabelText('1 material. Totales: 25 metro')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Quitar Cable UTP Cat6' })).toBeOnTheScreen();
  expect(screen.queryByTestId('add-material-sheet')).toBeNull();
  expect(db.rows('visit_materials')).toMatchObject([
    { visit_id: 'nueva-1', material_code: 'CABLE-UTP-CAT6', quantity: 25, unit: 'metro' },
  ]);

  // ── Resumen ──
  await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Resumen' }));
  expect(currentRoute().pathname).toBe('/visits/[visitId]/summary');
  expect(screen.getByLabelText('Materiales: 1 material · 25 metro')).toBeOnTheScreen();
  expect(screen.getByLabelText('Formulario técnico: Sin iniciar')).toBeOnTheScreen();
  expect(screen.getByLabelText('Fotografías: Sin fotografías')).toBeOnTheScreen();
  expect(screen.getByLabelText('Planos: Sin planos')).toBeOnTheScreen();

  // De vuelta al dashboard, los conteos reflejan la visita nueva ya iniciada.
  await act(async () => resetFakeRouter('/home'));
  expect(await screen.findByLabelText('En progreso: 2')).toBeOnTheScreen();
  expect(screen.getByLabelText('Asignadas: 2')).toBeOnTheScreen();
});

it('las pantallas no muestran ni modifican visitas de otro técnico', async () => {
  const foreign: Row = visitRow({
    id: 'ajena',
    technician_id: TECH_B,
    title: 'Visita ajena',
    status: 'inProgress',
  });
  db.insert('visits', [foreign]);
  db.insert('visit_materials', [visitMaterialRow({ id: 'vm-ajeno', visit_id: 'ajena' })]);

  resetFakeRouter('/visits');
  await render(<App />);
  expect(screen.queryByText('Visita ajena')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Buscar visitas'), 'ajena');
  expect(await screen.findByText('Sin resultados')).toBeOnTheScreen();

  // Abrir su detalle, sus materiales o su resumen por enlace directo: "no encontrada".
  for (const pathname of [
    '/visits/[visitId]',
    '/visits/[visitId]/materials',
    '/visits/[visitId]/summary',
  ]) {
    await act(async () => resetFakeRouter({ pathname, params: { visitId: 'ajena' } }));
    expect(
      await screen.findByText('No se encontró la visita. Es posible que ya no esté asignada a ti.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Material uno')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Iniciar visita' })).toBeNull();
  }
  expect(db.rows('visits').find((row) => row.id === 'ajena')).toEqual(foreign);
});
