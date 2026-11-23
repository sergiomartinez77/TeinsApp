import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import AssistantScreen from '@/app/(app)/assistant';
import { QuickActions } from '@/features/home/components/QuickActions';
import type { UserProfile } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';
import { currentRoute, resetFakeRouter } from '@/test-utils/fake-router';
import {
  catalogRow,
  materialStockRow,
  TECH_A,
  visitMaterialRow,
  visitRow,
} from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

import { useAssistantStore } from '../assistant.store';
import { ENGINE_LABELS } from '../components/ChatBubble';
import { ENGINE_NOTICES } from '../services/engine-selector';

/**
 * Pantalla del asistente sobre SQLite real. Se simulan la red, la función
 * remota (`supabase.functions.invoke`) y lo nativo (PDF y hoja de compartir,
 * ver jest.setup.ts).
 */

jest.mock('expo-router', () => jest.requireActual('@/test-utils/fake-router'));
jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined), fetch: jest.fn() },
}));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

let mockOnline = true;
jest.mock('@/hooks/useConnectivity', () => ({ useConnectivity: () => mockOnline }));

const mockInvoke = jest.fn();
let mockSupabaseConfigured = true;
jest.mock('@/services/supabase/client', () => ({
  getSupabase: () => {
    if (!mockSupabaseConfigured) throw new Error('Configuración incompleta');
    return { functions: { invoke: mockInvoke } };
  },
}));

const technician: UserProfile = {
  id: TECH_A,
  email: 'tecnico@teins.com',
  role: 'technician',
  fullName: 'Ana Pérez',
  phone: null,
  avatarUrl: null,
};

let db: TestDatabase;

async function renderScreen(isDemoMode = false) {
  useAuthStore.setState({
    status: 'authenticated',
    user: technician,
    isDemoMode,
    isSubmitting: false,
    error: null,
  });
  await render(<AssistantScreen />);
}

const notConfigured = () =>
  new FunctionsHttpError({ status: 503, json: async () => ({ code: 'not_configured' }) });

async function sendText(text: string) {
  await fireEvent.changeText(screen.getByTestId('assistant-input'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar pregunta' }));
}

const lastAssistant = () => screen.getAllByTestId('chat-assistant').at(-1);

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockSupabaseConfigured = true;
  resetFakeRouter('/assistant');
  db = createTestDatabase();
  db.insert('material_catalog', [
    catalogRow({ id: 'm-cable', code: 'CAB-01', name: 'Cable UTP', unit: 'metro', min_stock: 100 }),
  ]);
  db.insert('material_stock', [
    materialStockRow({ material_id: 'm-cable', on_hand: 49.5, purchased: 49.5 }),
  ]);
  db.insert('visits', [
    visitRow({
      id: 'v-a',
      client_name: 'Banco Central',
      title: 'Tablero',
      created_at: '2026-11-20T15:00:00.000Z',
    }),
    visitRow({
      id: 'v-b',
      client_name: 'Banco Central',
      title: 'UPS',
      created_at: '2026-11-10T15:00:00.000Z',
    }),
  ]);
  setTestDatabase(db);
});

afterEach(() => {
  setTestDatabase(null);
  useAssistantStore.getState().reset();
  useAuthStore.setState({ status: 'unauthenticated', user: null, isDemoMode: false });
});

it('bienvenida y sugerencia; sin función configurada responde el básico (y no se reintenta)', async () => {
  mockInvoke.mockResolvedValue({ data: null, error: notConfigured() });
  await renderScreen();

  expect(screen.getByText(ENGINE_LABELS.claude)).toBeOnTheScreen();
  expect(screen.getByText(/soy el asistente de TEINS/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '¿Qué tengo que comprar?' }));

  await waitFor(() => expect(screen.getByText(/conviene comprar/)).toBeOnTheScreen());
  expect(screen.getByText(/Cable UTP \(CAB-01\): comprar 51 metro/)).toBeOnTheScreen();
  expect(within(lastAssistant()!).getByText(ENGINE_LABELS.local)).toBeOnTheScreen();
  expect(screen.queryByText(ENGINE_NOTICES.offline)).toBeNull();
  expect(useAssistantStore.getState().remoteDisabled).toBe(true);
  // La cabecera ya indica el básico y la siguiente pregunta no llama a la función.
  expect(screen.getAllByText(ENGINE_LABELS.local).length).toBeGreaterThan(1);
  await sendText('visitas pendientes');
  await waitFor(() => expect(screen.getByText(/Tienes 2 visitas pendientes/)).toBeOnTheScreen());
  expect(mockInvoke).toHaveBeenCalledTimes(1);

  // "Abrir inventario" navega a la pantalla de inventario.
  await fireEvent.press(screen.getAllByRole('button', { name: 'Abrir inventario' })[0]!);
  expect(currentRoute().pathname).toBe('/inventory');
});

it('respuesta de Claude con PDF: la tarjeta lo genera en el teléfono y lo comparte', async () => {
  mockInvoke.mockResolvedValue({
    data: {
      text: 'Listo: toca «Compartir PDF».',
      actions: [{ type: 'share_pdf', visitId: 'v-a', label: 'Banco Central — Tablero' }],
    },
    error: null,
  });
  await renderScreen();
  await sendText('PDF de la visita del Banco Central de ayer');

  await waitFor(() => expect(screen.getByText('Listo: toca «Compartir PDF».')).toBeOnTheScreen());
  expect(within(lastAssistant()!).getByText(ENGINE_LABELS.claude)).toBeOnTheScreen();
  const [, options] = mockInvoke.mock.calls[0] as [string, { body: { messages: unknown[] } }];
  expect(options.body.messages).toEqual([
    { role: 'user', content: 'PDF de la visita del Banco Central de ayer' },
  ]);

  const card = screen.getByTestId('assistant-pdf-v-a');
  await fireEvent.press(
    within(card).getByRole('button', { name: 'Compartir PDF de Banco Central — Tablero' }),
  );
  await waitFor(() =>
    expect(within(card).getByText(/Último PDF: Visita_Banco_Central/)).toBeOnTheScreen(),
  );
  expect(Print.printToFileAsync).toHaveBeenCalledTimes(1);
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
});

it('PDF de una visita que no está en el teléfono: error en la tarjeta', async () => {
  mockInvoke.mockResolvedValue({
    data: {
      text: 'Toca «Compartir PDF».',
      actions: [{ type: 'share_pdf', visitId: 'v-otra', label: 'Otra' }],
    },
    error: null,
  });
  await renderScreen();
  await sendText('pdf de otra');
  const card = await screen.findByTestId('assistant-pdf-v-otra');
  await fireEvent.press(within(card).getByRole('button', { name: 'Compartir PDF de Otra' }));
  await waitFor(() => expect(within(card).getByText(/No se encontró la visita/)).toBeOnTheScreen());
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('sin conexión: básico con aviso; elegir una visita prepara su PDF', async () => {
  mockOnline = false;
  await renderScreen();
  expect(screen.getByText(ENGINE_LABELS.local)).toBeOnTheScreen();
  await sendText('informe del banco');

  await waitFor(() => expect(screen.getByText(ENGINE_NOTICES.offline)).toBeOnTheScreen());
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(screen.getByText(/Encontré 2 visitas/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: /Banco Central — UPS/ }));

  await waitFor(() => expect(screen.getByTestId('assistant-pdf-v-b')).toBeOnTheScreen());
  expect(screen.getByText(/^PDF de Banco Central — UPS/)).toBeOnTheScreen();
});

it('fallo de red de la función: responde el básico avisando', async () => {
  mockInvoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new Error('x')) });
  await renderScreen();
  await sendText('¿cuánto cable queda?');
  await waitFor(() => expect(screen.getByText(ENGINE_NOTICES.offline)).toBeOnTheScreen());
  expect(screen.getByText(/49,5 metro en bodega/)).toBeOnTheScreen();
  expect(useAssistantStore.getState().remoteDisabled).toBe(false);
});

it('modo demo o sin configuración de Supabase: solo el básico', async () => {
  await renderScreen(true);
  await sendText('hola');
  await waitFor(() => expect(screen.getByText(/^¡Hola!/)).toBeOnTheScreen());
  expect(mockInvoke).not.toHaveBeenCalled();

  await act(async () => useAssistantStore.getState().reset());
  mockSupabaseConfigured = false;
  useAuthStore.setState({ isDemoMode: false });
  await sendText('gracias');
  await waitFor(() => expect(screen.getByText(/De nada/)).toBeOnTheScreen());
  expect(mockInvoke).not.toHaveBeenCalled();
});

it('no envía preguntas vacías y muestra que está pensando', async () => {
  let resolve: (value: unknown) => void = () => undefined;
  mockInvoke.mockReturnValue(new Promise((done) => (resolve = done)));
  await renderScreen();
  expect(screen.getByRole('button', { name: 'Enviar pregunta' })).toBeDisabled();
  await sendText('   ');
  expect(mockInvoke).not.toHaveBeenCalled();

  await sendText('hola');
  expect(screen.getByTestId('assistant-typing')).toBeOnTheScreen();
  await act(async () => resolve({ data: { text: 'Hola, ¿en qué te ayudo?' }, error: null }));
  await waitFor(() => expect(screen.queryByTestId('assistant-typing')).toBeNull());
  expect(screen.getByText('Hola, ¿en qué te ayudo?')).toBeOnTheScreen();
});

it('acceso directo "Asistente" en el inicio', async () => {
  const onAssistant = jest.fn();
  await render(
    <QuickActions
      onMyVisits={jest.fn()}
      onNewVisit={jest.fn()}
      onInventory={jest.fn()}
      onAssistant={onAssistant}
    />,
  );
  await fireEvent.press(screen.getByLabelText('Asistente'));
  expect(onAssistant).toHaveBeenCalledTimes(1);
});

it('sin conexión: materiales de una visita; con varias coincidencias se elige y responde', async () => {
  mockOnline = false;
  db.insert('visit_materials', [
    visitMaterialRow({
      id: 'vm-ups',
      visit_id: 'v-b',
      material_id: 'm-cable',
      material_code: 'CAB-01',
      material_name: 'Cable UTP',
      unit: 'metro',
      quantity: 7.5,
    }),
  ]);
  await renderScreen();
  await sendText('¿cuánto cable usé en la visita del banco?');

  await waitFor(() => expect(screen.getByText(/Encontré 2 visitas/)).toBeOnTheScreen());
  const chip = screen.getByRole('button', { name: /Banco Central — UPS/ });
  expect(chip.props.accessibilityHint).toBe('Muestra los materiales de esta visita');
  await fireEvent.press(chip);

  await waitFor(() =>
    expect(screen.getByText(/• Cable UTP \(CAB-01\): 7,5 metro/)).toBeOnTheScreen(),
  );
  expect(screen.getByText(/^Materiales de Banco Central — UPS/)).toBeOnTheScreen();
});
