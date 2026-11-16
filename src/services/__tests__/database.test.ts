import {
  closeDatabase,
  connectDatabase,
  getDatabaseProfile,
  openDatabase,
} from '../powersync/database';

/**
 * Apertura y cierre de la base local. El constructor nativo de PowerSync y
 * op-sqlite se simulan: se prueba la lógica (reutilizar, cambiar de perfil,
 * conectar solo la principal, cerrar con y sin limpieza).
 */

interface FakeDb {
  file: string;
  init: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
  disconnectAndClear: jest.Mock;
  close: jest.Mock;
}

const mockCreated: FakeDb[] = [];
let mockInitDelay: Promise<void> | null = null;

jest.mock('@powersync/op-sqlite', () => ({
  OPSqliteOpenFactory: jest.fn((options: { dbFilename: string }) => options),
}));
jest.mock('@powersync/react-native', () => ({
  ...jest.requireActual<object>('@powersync/common'),
  PowerSyncDatabase: jest.fn((options: { database: { dbFilename: string } }) => {
    const db = {
      file: options.database.dbFilename,
      init: jest.fn(async () => {
        if (mockInitDelay) await mockInitDelay;
      }),
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      disconnectAndClear: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
    };
    mockCreated.push(db);
    return db;
  }),
}));
jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const connector = { fetchCredentials: jest.fn(), uploadData: jest.fn() };

beforeEach(async () => {
  await closeDatabase();
  mockCreated.length = 0;
  mockInitDelay = null;
});

it('abre la base principal y la reutiliza si ya está abierta', async () => {
  const first = await openDatabase('main');
  const second = await openDatabase('main');

  expect(second).toBe(first);
  expect(mockCreated).toHaveLength(1);
  expect(mockCreated[0]?.file).toBe('teins_local.db');
  expect(mockCreated[0]?.init).toHaveBeenCalledTimes(1);
  expect(getDatabaseProfile()).toBe('main');
});

it('al cambiar de perfil cierra la anterior (sin borrar) y abre la nueva', async () => {
  await openDatabase('main');
  await openDatabase('demo');

  const [main, demo] = mockCreated;
  expect(main?.disconnect).toHaveBeenCalled();
  expect(main?.disconnectAndClear).not.toHaveBeenCalled();
  expect(main?.close).toHaveBeenCalled();
  expect(demo?.file).toBe('teins_demo.db');
  expect(getDatabaseProfile()).toBe('demo');
});

it('espera a una apertura en curso antes de cambiar de perfil', async () => {
  let release: () => void = () => undefined;
  mockInitDelay = new Promise((resolve) => {
    release = resolve;
  });
  const opening = openDatabase('main');
  const switching = openDatabase('demo');
  mockInitDelay = null;
  release();

  await opening;
  await switching;
  expect(mockCreated.map((db) => db.file)).toEqual(['teins_local.db', 'teins_demo.db']);
  expect(mockCreated[0]?.close).toHaveBeenCalled();
  expect(getDatabaseProfile()).toBe('demo');
});

it('solo conecta la base principal; la demo nunca se sincroniza', async () => {
  await connectDatabase(connector);
  await openDatabase('demo');
  await connectDatabase(connector);
  expect(mockCreated[0]?.connect).not.toHaveBeenCalled();

  await openDatabase('main');
  await connectDatabase(connector);
  expect(mockCreated[1]?.connect).toHaveBeenCalledWith(connector);
});

it('cerrar con clear borra los datos; sin base abierta no hace nada', async () => {
  await openDatabase('demo');
  await closeDatabase({ clear: true });

  expect(mockCreated[0]?.disconnectAndClear).toHaveBeenCalled();
  expect(mockCreated[0]?.disconnect).not.toHaveBeenCalled();
  expect(mockCreated[0]?.close).toHaveBeenCalled();
  expect(getDatabaseProfile()).toBeNull();

  await expect(closeDatabase()).resolves.toBeUndefined();
});

it('si la apertura falla se puede reintentar', async () => {
  mockInitDelay = Promise.reject(new Error('disco lleno'));
  await expect(openDatabase('main')).rejects.toThrow('disco lleno');
  expect(getDatabaseProfile()).toBeNull();

  mockInitDelay = null;
  await expect(openDatabase('main')).resolves.toBe(mockCreated[1]);
});
