import type { SupabaseClient } from '@supabase/supabase-js';

import { needsRefresh, SupabaseConnector, type SessionLike } from '../powersync/connector';

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
