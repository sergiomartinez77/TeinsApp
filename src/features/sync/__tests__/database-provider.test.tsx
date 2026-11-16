import { useQuery } from '@powersync/react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useSessionBootstrap } from '@/features/auth/hooks/useSessionBootstrap';
import { startConnectivityMonitor } from '@/services/connectivity/connectivity.service';
import { onSessionEnded } from '@/services/supabase/auth.service';
import { registerAuthAutoRefresh } from '@/services/supabase/client';
import { useAuthStore } from '@/store/auth.store';
import { useSyncStore } from '@/store/sync.store';
import { visitRow } from '@/test-utils/fixtures';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';
import { DEFAULT_ERROR_MESSAGES } from '@/types/errors';

import { DatabaseProvider } from '../components/DatabaseProvider';

/**
 * `DatabaseProvider` con la base SQLite de test: abre la base, arranca el
 * monitor, la pone a disposición de las pantallas y la libera al desmontarse;
 * si no se puede abrir, muestra el error y permite reintentar.
 * También el arranque de la sesión (`useSessionBootstrap`).
 */

let mockDb: TestDatabase;
let mockFailures = 0;
const mockCalls: string[] = [];

jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('../session-database', () => ({
  prepareSessionDatabase: jest.fn(async (userId: string, isDemo: boolean) => {
    mockCalls.push(`prepare:${userId}:${isDemo ? 'demo' : 'main'}`);
    if (mockFailures > 0) {
      mockFailures -= 1;
      throw new Error('no se pudo abrir');
    }
    return mockDb;
  }),
  releaseSessionDatabase: jest.fn(async () => {
    mockCalls.push('release');
  }),
}));
jest.mock('@/features/photos/services/photo-uploader', () => ({
  startPhotoUploader: jest.fn(() => {
    mockCalls.push('uploader:start');
    return () => mockCalls.push('uploader:stop');
  }),
}));
jest.mock('@/features/photos/services/photo-trash', () => ({
  purgePhotoTrash: jest.fn(async () => undefined),
}));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});
jest.mock('@/services/connectivity/connectivity.service', () => ({
  startConnectivityMonitor: jest.fn(),
  isOnline: jest.fn(() => true),
  subscribeConnectivity: jest.fn(() => () => undefined),
}));
jest.mock('@/services/supabase/client', () => ({
  registerAuthAutoRefresh: jest.fn(() => jest.fn()),
}));
jest.mock('@/services/supabase/auth.service', () => ({
  getStoredUser: jest.fn(async () => null),
  onSessionEnded: jest.fn(() => jest.fn()),
  AUTH_MESSAGES: { sessionExpired: 'expirada' },
}));
let mockConfigComplete = true;
jest.mock('@/constants/config', () => ({
  appConfig: { logLevel: 'none' },
  missingConfigKeys: () => (mockConfigComplete ? [] : ['SUPABASE_URL']),
}));

/** Pantalla que lee de la base que pone el proveedor. */
function VisitCount() {
  const { data } = useQuery('SELECT id FROM visits');
  return <Text>{`Visitas: ${data.length}`}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockFailures = 0;
  mockConfigComplete = true;
  mockDb = createTestDatabase();
  mockDb.insert('visits', [visitRow()]);
});

describe('DatabaseProvider', () => {
  it('abre la base, arranca monitor y subidas, y al desmontarse lo libera todo', async () => {
    const view = await render(
      <DatabaseProvider userId="t1" isDemo={false}>
        <VisitCount />
      </DatabaseProvider>,
    );

    expect(await screen.findByText('Visitas: 1')).toBeOnTheScreen();
    expect(mockCalls).toEqual(['prepare:t1:main', 'uploader:start']);

    // El monitor ya escucha a la base: publica su estado en el store.
    await act(async () => {
      mockDb.setUploadQueueCount(2);
      mockDb.setStatus({ connected: true });
    });
    expect(useSyncStore.getState().pendingCount).toBe(2);

    await view.unmount();
    expect(mockCalls).toEqual(['prepare:t1:main', 'uploader:start', 'uploader:stop', 'release']);
  });

  it('en modo demo no arranca el gestor de subidas', async () => {
    await render(
      <DatabaseProvider userId="demo" isDemo>
        <VisitCount />
      </DatabaseProvider>,
    );
    expect(await screen.findByText('Visitas: 1')).toBeOnTheScreen();
    expect(mockCalls).toEqual(['prepare:demo:demo']);
  });

  it('si no se puede abrir muestra el error y "Reintentar" vuelve a intentarlo', async () => {
    mockFailures = 1;
    await render(
      <DatabaseProvider userId="t1" isDemo={false}>
        <VisitCount />
      </DatabaseProvider>,
    );

    expect(await screen.findByText(DEFAULT_ERROR_MESSAGES.database)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Visitas: 1')).toBeOnTheScreen();
    expect(mockCalls.filter((call) => call.startsWith('prepare'))).toHaveLength(2);
  });
});

describe('useSessionBootstrap', () => {
  it('vigila la red, revisa la sesión guardada y mantiene el token fresco', async () => {
    const { unmount } = await renderHook(() => useSessionBootstrap());

    expect(startConnectivityMonitor).toHaveBeenCalled();
    expect(registerAuthAutoRefresh).toHaveBeenCalled();
    expect(onSessionEnded).toHaveBeenCalledWith(useAuthStore.getState().handleSessionEnded);
    await act(async () => undefined);
    expect(useAuthStore.getState().status).toBe('unauthenticated');

    const stopRefresh = jest.mocked(registerAuthAutoRefresh).mock.results[0]?.value as jest.Mock;
    const stopListening = jest.mocked(onSessionEnded).mock.results[0]?.value as jest.Mock;
    await unmount();
    expect(stopRefresh).toHaveBeenCalled();
    expect(stopListening).toHaveBeenCalled();
  });

  it('sin configuración no crea el cliente de Supabase', async () => {
    mockConfigComplete = false;
    await renderHook(() => useSessionBootstrap());
    await act(async () => undefined);
    expect(registerAuthAutoRefresh).not.toHaveBeenCalled();
    expect(onSessionEnded).not.toHaveBeenCalled();
  });
});
