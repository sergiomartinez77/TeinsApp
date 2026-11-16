import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import { useAutosave } from '@/hooks/useAutosave';
import { trackPendingWrite, waitForPendingWrites } from '@/services/powersync/pending-writes';

import { prepareSessionDatabase, releaseSessionDatabase } from '../session-database';

const mockEvents: string[] = [];
let mockProfile: 'main' | 'demo' | null = null;

jest.mock('@/services/powersync/database', () => ({
  openDatabase: jest.fn(async (profile: 'main' | 'demo') => {
    mockProfile = profile;
    return { disconnectAndClear: jest.fn(async () => undefined) };
  }),
  connectDatabase: jest.fn(async () => undefined),
  closeDatabase: jest.fn(async (options: { clear?: boolean } = {}) => {
    mockEvents.push(`close:${options.clear ? 'clear' : 'keep'}`);
    mockProfile = null;
  }),
  getDatabaseProfile: jest.fn(() => mockProfile),
}));

jest.mock('@/services/storage/secure-storage', () => ({
  getSecureItem: jest.fn(async () => 'user-1'),
  setSecureItem: jest.fn(async () => undefined),
}));

jest.mock('@/services/supabase/client', () => ({ getSupabase: jest.fn(() => ({})) }));
jest.mock('@/services/powersync/connector', () => ({ SupabaseConnector: jest.fn() }));

/** Promesa que el test resuelve cuando quiere. */
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Pantalla de edición con un cambio sin guardar (como el formulario o las anotaciones). */
function EditorScreen({ save }: { save: (value: string) => Promise<boolean> }) {
  const { schedule } = useAutosave<string>({ save, delayMs: 10_000 });
  useEffect(() => {
    schedule('cambio sin guardar');
  }, [schedule]);
  return null;
}

/** Igual que `DatabaseProvider`: al desmontarse cierra la base de la sesión. */
function SessionScope({ save }: { save: (value: string) => Promise<boolean> }) {
  useEffect(
    () => () => {
      void releaseSessionDatabase();
    },
    [],
  );
  return <EditorScreen save={save} />;
}

beforeEach(() => {
  mockEvents.length = 0;
  mockProfile = null;
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('sesión terminada con cambios sin guardar', () => {
  it('el guardado inmediato al desmontar termina antes de cerrar la base', async () => {
    await prepareSessionDatabase('user-1', false);
    const write = deferred();
    const save = jest.fn(async () => {
      mockEvents.push('save:start');
      await write.promise;
      mockEvents.push('save:end');
      return true;
    });

    const view = await render(<SessionScope save={save} />);
    // La sesión expira: el layout deja de mostrar las pantallas protegidas.
    await view.unmount();

    // La escritura sigue en curso: la base aún no se puede cerrar.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockEvents).not.toContain('close:keep');

    write.resolve();
    await act(async () => {
      await releaseSessionDatabase();
    });

    expect(save).toHaveBeenCalledWith('cambio sin guardar');
    expect(mockEvents).toEqual(['save:start', 'save:end', 'close:keep']);
  });
});

describe('trackPendingWrite', () => {
  it('waitForPendingWrites espera a las escrituras registradas, también a las fallidas', async () => {
    const first = deferred();
    const order: string[] = [];
    void trackPendingWrite(first.promise.then(() => order.push('primera')));
    void trackPendingWrite(Promise.reject(new Error('fallo'))).catch(() => undefined);

    const waiting = waitForPendingWrites().then(() => order.push('fin'));
    await Promise.resolve();
    expect(order).toEqual([]);

    first.resolve();
    await waiting;
    expect(order).toEqual(['primera', 'fin']);
  });

  it('sin escrituras pendientes no espera', async () => {
    await expect(waitForPendingWrites()).resolves.toBeUndefined();
  });
});
