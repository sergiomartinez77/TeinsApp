import {
  createPhotoUploader,
  UPLOAD_RETRY_MS,
  type PhotoUploaderDeps,
  type UploaderDatabase,
} from '../services/photo-uploader';

import { createFakeFiles, photoRow, visitRow, type Row } from './fakes';

jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/services/connectivity/connectivity.service', () => ({
  isOnline: jest.fn(() => true),
  subscribeConnectivity: jest.fn(() => () => undefined),
}));

jest.mock('../services/photo-storage', () => ({
  supabasePhotoStorage: { upload: jest.fn(), objectUrl: jest.fn() },
}));

const PENDING = new Set(['local', 'pendingUpload', 'uploadError']);
const NOW = new Date('2026-06-02T12:00:00.000Z');

/** Base falsa para el gestor: `getAll` y `execute` sobre `visits` y `photos`. */
function createUploaderDb(photos: Row[], visits: Row[] = [visitRow()]) {
  const table = new Map(photos.map((row) => [String(row.id), { ...row }]));
  const ownVisits = (technicianId: unknown) =>
    new Set(visits.filter((visit) => visit.technician_id === technicianId).map((v) => v.id));
  const pending = (technicianId: unknown) =>
    [...table.values()]
      .filter((row) => PENDING.has(String(row.sync_status)))
      .filter((row) => ownVisits(technicianId).has(row.visit_id))
      .sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
  const history: { id: string; status: unknown }[] = [];

  const db: UploaderDatabase & { getAll: jest.Mock; execute: jest.Mock } = {
    getAll: jest.fn(async (sql: string, parameters: unknown[] = []): Promise<never[]> => {
      const rows = pending(parameters[0]);
      // Las filas falsas no conocen el tipo que pide cada consulta.
      if (sql.includes('COUNT(*)')) return [{ count: rows.length }] as never[];
      return rows.map((row) => ({ ...row })) as never[];
    }),
    execute: jest.fn(async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes("WHERE sync_status = 'uploading'")) {
        const own = ownVisits(parameters[0]);
        table.forEach((row) => {
          if (row.sync_status === 'uploading' && own.has(row.visit_id)) {
            row.sync_status = 'pendingUpload';
          }
        });
      } else if (sql.includes("sync_status = 'uploaded'")) {
        const [storagePath, storageUrl, uploadedAt, id] = parameters;
        const row = table.get(String(id));
        if (row) {
          Object.assign(row, {
            sync_status: 'uploaded',
            storage_path: storagePath,
            storage_url: storageUrl,
            uploaded_at: uploadedAt,
          });
          history.push({ id: String(id), status: 'uploaded' });
        }
      } else if (sql.includes('SET sync_status = ?')) {
        const [status, id] = parameters;
        const row = table.get(String(id));
        if (row) row.sync_status = status;
        history.push({ id: String(id), status });
      } else {
        throw new Error(`Sentencia no esperada: ${sql}`);
      }
    }),
  };
  return { db, table, history };
}

function createConnectivity(initial = true) {
  let online = initial;
  const listeners = new Set<() => void>();
  const unsubscribe = jest.fn();
  return {
    connectivity: {
      isOnline: () => online,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          unsubscribe();
          listeners.delete(listener);
        };
      },
    },
    setOnline: (value: boolean) => {
      online = value;
      listeners.forEach((listener) => listener());
    },
    unsubscribe,
    listenerCount: () => listeners.size,
  };
}

function setup(
  photos: Row[],
  {
    online = true,
    files = createFakeFiles(
      Object.fromEntries(photos.map((photo) => [String(photo.local_path), 1000])),
    ).files,
    upload = jest.fn(async () => undefined),
  }: {
    online?: boolean;
    files?: PhotoUploaderDeps['files'];
    upload?: jest.Mock;
  } = {},
) {
  const store = createUploaderDb(photos);
  const net = createConnectivity(online);
  const storage = {
    upload,
    objectUrl: (path: string) =>
      `https://proyecto.supabase.co/storage/v1/object/visit-photos/${path}`,
  };
  const uploader = createPhotoUploader({
    db: store.db,
    technicianId: 't1',
    storage,
    files,
    connectivity: net.connectivity,
    now: () => NOW,
  });
  return { ...store, ...net, storage, uploader };
}

/** Deja que terminen las promesas pendientes (pasadas en curso). */
async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('createPhotoUploader', () => {
  it('sube las pendientes en orden y las marca como subidas', async () => {
    const { uploader, storage, table, history } = setup([
      photoRow({
        id: 'p2',
        local_path: 'teins_photos/p2.jpg',
        captured_at: '2026-06-01T09:00:00Z',
      }),
      photoRow({
        id: 'p1',
        local_path: 'teins_photos/p1.jpg',
        captured_at: '2026-06-01T08:00:00Z',
      }),
      photoRow({ id: 'p3', sync_status: 'uploaded', local_path: 'teins_photos/p3.jpg' }),
    ]);
    await uploader.trigger();

    expect(storage.upload.mock.calls.map((call) => call[0])).toEqual([
      'visits/v1/photos/p1.jpg',
      'visits/v1/photos/p2.jpg',
    ]);
    expect(history).toEqual([
      { id: 'p1', status: 'uploading' },
      { id: 'p1', status: 'uploaded' },
      { id: 'p2', status: 'uploading' },
      { id: 'p2', status: 'uploaded' },
    ]);
    expect(table.get('p1')).toEqual(
      expect.objectContaining({
        sync_status: 'uploaded',
        storage_path: 'visits/v1/photos/p1.jpg',
        storage_url:
          'https://proyecto.supabase.co/storage/v1/object/visit-photos/visits/v1/photos/p1.jpg',
        uploaded_at: NOW.toISOString(),
      }),
    );
    uploader.stop();
  });

  it('la ruta remota es visits/<visitId>/photos/<photoId>.jpg', async () => {
    const { uploader, storage } = setup([
      photoRow({ id: 'abc', visit_id: 'v1', local_path: 'teins_photos/abc.jpg' }),
    ]);
    await uploader.trigger();

    expect(storage.upload).toHaveBeenCalledWith(
      'visits/v1/photos/abc.jpg',
      expect.any(ArrayBuffer),
    );
    uploader.stop();
  });

  it('si una subida falla la marca con error y continúa con la siguiente', async () => {
    const upload = jest.fn(async (path: string) => {
      if (path.includes('p1')) throw new Error('Error 500');
    });
    const { uploader, table } = setup(
      [
        photoRow({ id: 'p1', local_path: 'teins_photos/p1.jpg', captured_at: '2026-06-01T08:00Z' }),
        photoRow({ id: 'p2', local_path: 'teins_photos/p2.jpg', captured_at: '2026-06-01T09:00Z' }),
      ],
      { upload },
    );
    await uploader.trigger();

    expect(table.get('p1')?.sync_status).toBe('uploadError');
    expect(table.get('p1')?.storage_path).toBeNull();
    expect(table.get('p2')?.sync_status).toBe('uploaded');
    // La foto fallida no se reintenta dentro de la misma pasada.
    expect(upload).toHaveBeenCalledTimes(2);
    uploader.stop();
  });

  it('si el archivo local no existe la marca con error sin intentar subirla', async () => {
    const { files } = createFakeFiles({});
    const { uploader, storage, table } = setup([photoRow({ id: 'p1' })], { files });
    await uploader.trigger();

    expect(storage.upload).not.toHaveBeenCalled();
    expect(table.get('p1')?.sync_status).toBe('uploadError');
    uploader.stop();
  });

  it('sin conexión no intenta nada', async () => {
    const { uploader, storage, db, table } = setup([photoRow({ id: 'p1' })], { online: false });
    await uploader.trigger();
    await flush();

    expect(storage.upload).not.toHaveBeenCalled();
    expect(db.getAll).not.toHaveBeenCalled();
    expect(table.get('p1')?.sync_status).toBe('local');
    uploader.stop();
  });

  it('al recuperar la conexión dispara una pasada', async () => {
    const { uploader, storage, setOnline, table } = setup([photoRow({ id: 'p1' })], {
      online: false,
    });
    await flush();
    expect(storage.upload).not.toHaveBeenCalled();

    // El propio aviso de conexión dispara la pasada (sin llamar a trigger).
    setOnline(true);
    await flush(50);

    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(table.get('p1')?.sync_status).toBe('uploaded');
    uploader.stop();
  });

  it('no solapa pasadas: un disparo durante una pasada usa la misma', async () => {
    let release: () => void = () => undefined;
    const upload = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { uploader } = setup([photoRow({ id: 'p1' })], { upload });

    const first = uploader.trigger();
    await flush();
    const second = uploader.trigger();
    expect(second).toBe(first);
    await flush();
    expect(upload).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(upload).toHaveBeenCalledTimes(1);
    uploader.stop();
  });

  it('reintenta a los 60 s solo si quedan pendientes', async () => {
    let fail = true;
    const upload = jest.fn(async () => {
      if (fail) throw new Error('Error 503');
    });
    const { uploader, table } = setup([photoRow({ id: 'p1' })], { upload });
    await uploader.trigger();
    expect(table.get('p1')?.sync_status).toBe('uploadError');

    fail = false;
    await jest.advanceTimersByTimeAsync(UPLOAD_RETRY_MS - 1);
    expect(upload).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(table.get('p1')?.sync_status).toBe('uploaded');

    // Sin pendientes no se programa otro reintento.
    expect(jest.getTimerCount()).toBe(0);
    uploader.stop();
  });

  it('al arrancar devuelve a la cola las fotos que quedaron subiendo', async () => {
    const { uploader, table, storage } = setup([photoRow({ id: 'p1', sync_status: 'uploading' })], {
      online: false,
    });
    await flush();

    expect(table.get('p1')?.sync_status).toBe('pendingUpload');
    expect(storage.upload).not.toHaveBeenCalled();
    uploader.stop();
  });

  it('stop() cancela el temporizador y la suscripción a la conectividad', async () => {
    const upload = jest.fn(async () => {
      throw new Error('Error 503');
    });
    const { uploader, unsubscribe, listenerCount, setOnline } = setup([photoRow({ id: 'p1' })], {
      upload,
    });
    await uploader.trigger();
    expect(jest.getTimerCount()).toBe(1);

    uploader.stop();

    expect(jest.getTimerCount()).toBe(0);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(0);
    setOnline(false);
    setOnline(true);
    await jest.advanceTimersByTimeAsync(UPLOAD_RETRY_MS * 2);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
