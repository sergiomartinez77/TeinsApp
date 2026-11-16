import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createSupabaseWriter,
  needsRefresh,
  SupabaseConnector,
  type SessionLike,
} from '../powersync/connector';

const NOW = Date.parse('2026-01-15T12:00:00Z');
const inSeconds = (seconds: number) => Math.floor(NOW / 1000) + seconds;

interface AuthResponse {
  data: { session: SessionLike | null };
  error: Error | null;
}

function createSupabase(current: AuthResponse, refreshed?: AuthResponse) {
  const auth = {
    getSession: jest.fn(async () => current),
    refreshSession: jest.fn(
      async () => refreshed ?? { data: { session: null }, error: new Error('sin red') },
    ),
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}

const ENDPOINT = 'https://demo.powersync.example';

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('needsRefresh', () => {
  it('pide refrescar si el token vence en menos de 5 minutos', () => {
    expect(needsRefresh({ access_token: 't', expires_at: inSeconds(4 * 60) }, NOW)).toBe(true);
    expect(needsRefresh({ access_token: 't', expires_at: inSeconds(6 * 60) }, NOW)).toBe(false);
    expect(needsRefresh({ access_token: 't', expires_at: inSeconds(-10) }, NOW)).toBe(true);
    expect(needsRefresh({ access_token: 't' }, NOW)).toBe(false);
  });
});

describe('SupabaseConnector.fetchCredentials', () => {
  it('devuelve null si no hay sesión', async () => {
    const { client } = createSupabase({ data: { session: null }, error: null });

    expect(await new SupabaseConnector(client, ENDPOINT).fetchCredentials()).toBeNull();
  });

  it('usa el token vigente sin refrescar', async () => {
    const { client, auth } = createSupabase({
      data: { session: { access_token: 'vigente', expires_at: inSeconds(3600) } },
      error: null,
    });

    const credentials = await new SupabaseConnector(client, ENDPOINT).fetchCredentials();

    expect(credentials).toEqual({
      endpoint: ENDPOINT,
      token: 'vigente',
      expiresAt: new Date(inSeconds(3600) * 1000),
    });
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('refresca el token si está por vencer', async () => {
    const { client, auth } = createSupabase(
      { data: { session: { access_token: 'viejo', expires_at: inSeconds(60) } }, error: null },
      { data: { session: { access_token: 'nuevo', expires_at: inSeconds(3600) } }, error: null },
    );

    const credentials = await new SupabaseConnector(client, ENDPOINT).fetchCredentials();

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(credentials?.token).toBe('nuevo');
  });

  it('si no puede refrescar pero el token aún sirve, lo usa', async () => {
    const { client } = createSupabase({
      data: { session: { access_token: 'casi-vencido', expires_at: inSeconds(60) } },
      error: null,
    });

    const credentials = await new SupabaseConnector(client, ENDPOINT).fetchCredentials();

    expect(credentials?.token).toBe('casi-vencido');
  });

  it('si no puede refrescar y el token ya venció, falla para que se reintente', async () => {
    const { client } = createSupabase({
      data: { session: { access_token: 'vencido', expires_at: inSeconds(-60) } },
      error: null,
    });

    await expect(new SupabaseConnector(client, ENDPOINT).fetchCredentials()).rejects.toThrow(
      'sin red',
    );
  });

  it('propaga el error al leer la sesión', async () => {
    const { client } = createSupabase({ data: { session: null }, error: new Error('lectura') });

    await expect(new SupabaseConnector(client, ENDPOINT).fetchCredentials()).rejects.toThrow(
      'lectura',
    );
  });
});

describe('createSupabaseWriter', () => {
  function fakeSupabase(error: { code: string; message: string } | null = null) {
    const calls: unknown[][] = [];
    const chain = (operation: string, ...args: unknown[]) => ({
      eq: async (column: string, value: unknown) => {
        calls.push([operation, ...args, column, value]);
        return { error };
      },
    });
    const client = {
      from: (table: string) => ({
        upsert: async (row: unknown) => {
          calls.push(['upsert', table, row]);
          return { error };
        },
        update: (changes: unknown) => chain('update', table, changes),
        delete: () => chain('delete', table),
      }),
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it('traduce upsert, update y delete a PostgREST filtrando por id', async () => {
    const { client, calls } = fakeSupabase();
    const writer = createSupabaseWriter(client);

    expect(await writer.upsert('visits', { id: 'v1', title: 'T' })).toEqual({ error: null });
    expect(await writer.update('visits', 'v1', { title: 'U' })).toEqual({ error: null });
    expect(await writer.remove('visit_materials', 'm1')).toEqual({ error: null });
    expect(calls).toEqual([
      ['upsert', 'visits', { id: 'v1', title: 'T' }],
      ['update', 'visits', { title: 'U' }, 'id', 'v1'],
      ['delete', 'visit_materials', 'id', 'm1'],
    ]);
  });

  it('devuelve el error del servidor sin lanzar', async () => {
    const rejected = { code: '42501', message: 'sin permiso' };
    const writer = createSupabaseWriter(fakeSupabase(rejected).client);
    expect(await writer.update('visits', 'v1', {})).toEqual({ error: rejected });
    expect(await writer.remove('visits', 'v1')).toEqual({ error: rejected });
  });
});
