import { SECURE_KEYS } from '@/constants/app.constants';
import * as connectivity from '@/services/connectivity/connectivity.service';
import { setSecureItem } from '@/services/storage/secure-storage';
import { useSyncStore } from '@/store/sync.store';

import { startSyncMonitor, type SyncMonitorSource, type SyncStatusLike } from '../sync-monitor';

jest.mock('@/services/connectivity/connectivity.service', () => ({
  isOnline: jest.fn(() => true),
  subscribeConnectivity: jest.fn(),
}));

jest.mock('@/services/storage/secure-storage', () => ({
  setSecureItem: jest.fn(async () => undefined),
}));

const net = jest.mocked(connectivity);

const status = (overrides: Partial<SyncStatusLike> = {}): SyncStatusLike => ({
  connected: true,
  connecting: false,
  dataFlowStatus: {},
  ...overrides,
});

function createSource(initial: SyncStatusLike = status()) {
  let pending = 0;
  let statusListener: (next: SyncStatusLike) => void = () => undefined;
  let changeListener: () => void | Promise<void> = () => undefined;
  let signal: AbortSignal | null = null;
  const stopStatus = jest.fn();

  const source: SyncMonitorSource = {
    currentStatus: initial,
    registerListener: (listener) => {
      statusListener = listener.statusChanged ?? statusListener;
      return stopStatus;
    },
    getUploadQueueStats: jest.fn(async () => ({ count: pending })),
    onChange: (handler, options) => {
      changeListener = handler.onChange;
      signal = options.signal;
      return undefined;
    },
  };

  return {
    source,
    stopStatus,
    setPending: (count: number) => {
      pending = count;
    },
    emitStatus: (next: SyncStatusLike) => statusListener(next),
    emitChange: () => changeListener(),
    isAborted: () => signal?.aborted ?? false,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const snapshot = () => {
  const { state, pendingCount, lastSyncedAt } = useSyncStore.getState();
  return { state, pendingCount, lastSyncedAt };
};

let emitConnectivity: () => void = () => undefined;
const stopConnectivity = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  useSyncStore.getState().reset();
  net.isOnline.mockReturnValue(true);
  net.subscribeConnectivity.mockImplementation((listener) => {
    emitConnectivity = listener;
    return stopConnectivity;
  });
});

describe('monitor de sincronización', () => {
  it('publica el estado inicial y el número de cambios pendientes', async () => {
    const fake = createSource();
    fake.setPending(3);

    startSyncMonitor(fake.source, { isDemo: false });
    expect(snapshot().state).toBe('synced');

    await flush();
    expect(snapshot()).toMatchObject({ state: 'pending', pendingCount: 3 });
  });

  it('reacciona a los cambios de estado de PowerSync', async () => {
    const fake = createSource();
    startSyncMonitor(fake.source, { isDemo: false });
    await flush();

    fake.emitStatus(status({ dataFlowStatus: { uploading: true } }));
    expect(snapshot().state).toBe('syncing');

    fake.emitStatus(
      status({ connected: false, dataFlowStatus: { downloadError: new Error('x') } }),
    );
    expect(snapshot().state).toBe('error');
  });

  it('sin red muestra "sin conexión" aunque PowerSync reporte error', async () => {
    const fake = createSource(
      status({ connected: false, dataFlowStatus: { downloadError: new Error('sin red') } }),
    );
    net.isOnline.mockReturnValue(false);

    startSyncMonitor(fake.source, { isDemo: false });
    expect(snapshot().state).toBe('offline');

    net.isOnline.mockReturnValue(true);
    emitConnectivity();
    expect(snapshot().state).toBe('error');
  });

  it('actualiza los pendientes cuando cambian las tablas locales', async () => {
    const fake = createSource();
    startSyncMonitor(fake.source, { isDemo: false });
    await flush();
    expect(snapshot().pendingCount).toBe(0);

    fake.setPending(2);
    await fake.emitChange();

    expect(snapshot()).toMatchObject({ state: 'pending', pendingCount: 2 });
  });

  it('guarda una sola vez cada fecha de última sincronización', async () => {
    const lastSyncedAt = new Date('2026-03-01T10:00:00Z');
    const fake = createSource(status({ lastSyncedAt }));

    startSyncMonitor(fake.source, { isDemo: false });
    fake.emitStatus(status({ lastSyncedAt }));
    await flush();

    expect(snapshot().lastSyncedAt).toBe('2026-03-01T10:00:00.000Z');
    expect(setSecureItem).toHaveBeenCalledTimes(1);
    expect(setSecureItem).toHaveBeenCalledWith(SECURE_KEYS.lastSync, '2026-03-01T10:00:00.000Z');
  });

  it('en modo demo no cuenta pendientes y muestra el estado demo', async () => {
    const fake = createSource();
    fake.setPending(7);

    startSyncMonitor(fake.source, { isDemo: true });
    await flush();

    expect(snapshot()).toMatchObject({ state: 'demo', pendingCount: 0 });
    expect(fake.source.getUploadQueueStats).not.toHaveBeenCalled();
  });

  it('al detenerse deja de escuchar y reinicia el store', async () => {
    const fake = createSource();
    fake.setPending(5);
    const stop = startSyncMonitor(fake.source, { isDemo: false });
    await flush();

    stop();

    expect(fake.stopStatus).toHaveBeenCalledTimes(1);
    expect(stopConnectivity).toHaveBeenCalledTimes(1);
    expect(fake.isAborted()).toBe(true);
    expect(snapshot()).toMatchObject({ state: 'syncing', pendingCount: 0 });

    fake.emitStatus(status({ dataFlowStatus: { uploadError: new Error('x') } }));
    expect(snapshot().state).toBe('syncing');
  });
});
