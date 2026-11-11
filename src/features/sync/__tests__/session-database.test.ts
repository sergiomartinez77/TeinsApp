import { SECURE_KEYS } from '@/constants/app.constants';
import * as database from '@/services/powersync/database';

import { DEMO_MATERIALS, DEMO_VISITS, seedDemoData } from '../demo-seed';
import { prepareSessionDatabase, releaseSessionDatabase } from '../session-database';

const mockSecure = new Map<string, string>();
const mockEvents: string[] = [];

interface Statement {
  sql: string;
  parameters: unknown[];
}

function createFakeDb() {
  const statements: Statement[] = [];
  return {
    statements,
    disconnectAndClear: jest.fn(async () => {
      mockEvents.push('clear');
    }),
    writeTransaction: async <T>(
      callback: (tx: {
        execute: (sql: string, parameters?: unknown[]) => Promise<void>;
      }) => Promise<T>,
    ) =>
      callback({
        execute: async (sql, parameters = []) => {
          statements.push({ sql, parameters });
        },
      }),
  };
}

let mockDb = createFakeDb();
let mockProfile: 'main' | 'demo' | null = null;

jest.mock('@/services/powersync/database', () => ({
  openDatabase: jest.fn(async (profile: 'main' | 'demo') => {
    mockEvents.push(`open:${profile}`);
    mockProfile = profile;
    return mockDb;
  }),
  connectDatabase: jest.fn(async () => {
    mockEvents.push('connect');
  }),
  closeDatabase: jest.fn(async (options: { clear?: boolean } = {}) => {
    mockEvents.push(`close:${options.clear ? 'clear' : 'keep'}`);
    mockProfile = null;
  }),
  getDatabaseProfile: jest.fn(() => mockProfile),
}));

jest.mock('@/services/storage/secure-storage', () => ({
  getSecureItem: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setSecureItem: jest.fn(async (key: string, value: string) => {
    mockSecure.set(key, value);
  }),
}));

jest.mock('@/services/supabase/client', () => ({ getSupabase: jest.fn(() => ({})) }));
jest.mock('@/services/powersync/connector', () => ({
  SupabaseConnector: jest.fn(),
}));

const db = jest.mocked(database);

beforeEach(() => {
  jest.clearAllMocks();
  mockSecure.clear();
  mockEvents.length = 0;
  mockDb = createFakeDb();
  mockProfile = null;
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('sesión real', () => {
  it('abre la base principal, registra al dueño y conecta en segundo plano', async () => {
    await prepareSessionDatabase('user-1', false);

    expect(mockEvents).toEqual(['open:main', 'connect']);
    expect(mockSecure.get(SECURE_KEYS.databaseOwner)).toBe('user-1');
    expect(mockDb.disconnectAndClear).not.toHaveBeenCalled();
  });

  it('conserva los datos cuando vuelve a entrar el mismo técnico', async () => {
    mockSecure.set(SECURE_KEYS.databaseOwner, 'user-1');

    await prepareSessionDatabase('user-1', false);

    expect(mockDb.disconnectAndClear).not.toHaveBeenCalled();
  });

  it('limpia los datos locales si entra un técnico distinto', async () => {
    mockSecure.set(SECURE_KEYS.databaseOwner, 'user-1');

    await prepareSessionDatabase('user-2', false);

    expect(mockEvents).toEqual(['open:main', 'clear', 'connect']);
    expect(mockSecure.get(SECURE_KEYS.databaseOwner)).toBe('user-2');
  });

  it('abre la base aunque falle el inicio de la sincronización', async () => {
    db.connectDatabase.mockRejectedValueOnce(new Error('sin red'));

    await expect(prepareSessionDatabase('user-1', false)).resolves.toBe(mockDb);
  });

  it('al cerrar sesión conserva los datos locales', async () => {
    await prepareSessionDatabase('user-1', false);
    await releaseSessionDatabase();

    expect(mockEvents.at(-1)).toBe('close:keep');
  });
});

describe('modo demo', () => {
  it('usa la base aislada, la vacía, carga los datos de ejemplo y nunca conecta', async () => {
    await prepareSessionDatabase('demo-user', true);

    expect(mockEvents).toEqual(['open:demo', 'clear']);
    expect(db.connectDatabase).not.toHaveBeenCalled();
    expect(mockDb.statements).toHaveLength(DEMO_MATERIALS.length + DEMO_VISITS.length);
    expect(mockSecure.has(SECURE_KEYS.databaseOwner)).toBe(false);
  });

  it('al salir borra los datos de ejemplo', async () => {
    await prepareSessionDatabase('demo-user', true);
    await releaseSessionDatabase();

    expect(mockEvents.at(-1)).toBe('close:clear');
  });
});

describe('orden de operaciones', () => {
  it('no solapa el cierre de una sesión con la apertura de la siguiente', async () => {
    const first = prepareSessionDatabase('user-1', false);
    const closing = releaseSessionDatabase();
    const second = prepareSessionDatabase('demo-user', true);
    await Promise.all([first, closing, second]);

    expect(mockEvents).toEqual(['open:main', 'connect', 'close:keep', 'open:demo', 'clear']);
  });

  it('no hace nada al cerrar si no hay base abierta', async () => {
    await releaseSessionDatabase();
    expect(db.closeDatabase).not.toHaveBeenCalled();
  });

  it('un fallo al abrir no bloquea los intentos siguientes', async () => {
    db.openDatabase.mockRejectedValueOnce(new Error('disco'));

    await expect(prepareSessionDatabase('user-1', false)).rejects.toThrow('disco');
    await expect(prepareSessionDatabase('user-1', false)).resolves.toBe(mockDb);
  });
});

describe('datos de ejemplo', () => {
  it('incluye los 14 materiales y las 3 visitas del seed original', () => {
    expect(DEMO_MATERIALS).toHaveLength(14);
    expect(new Set(DEMO_MATERIALS.map((material) => material.code)).size).toBe(14);
    expect(DEMO_VISITS.map((visit) => visit.visitType)).toEqual([
      'infraestructura',
      'energia',
      'datos',
    ]);
  });

  it('asigna las visitas al técnico demo con fechas coherentes', async () => {
    const fake = createFakeDb();
    const now = new Date('2026-05-10T12:00:00Z');

    await seedDemoData(fake, 'demo-user', now);

    const visits = fake.statements.filter((statement) => statement.sql.includes('INTO visits'));
    expect(visits).toHaveLength(3);
    for (const visit of visits) expect(visit.parameters[0]).toBe('demo-user');

    const inProgress = visits.find((visit) => visit.parameters[6] === 'inProgress');
    // creada hace 24 h, iniciada hace 23 h
    expect(inProgress?.parameters[7]).toBe('2026-05-09T12:00:00.000Z');
    expect(inProgress?.parameters[9]).toBe('2026-05-09T13:00:00.000Z');

    const assigned = visits.find((visit) => visit.parameters[6] === 'assigned');
    expect(assigned?.parameters[9]).toBeNull();
  });
});
