import * as SecureStore from 'expo-secure-store';

import {
  CHUNK_SIZE,
  getSecureItem,
  removeSecureItem,
  setSecureItem,
  splitIntoChunks,
} from '../storage/secure-storage';

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (new TextEncoder().encode(value).length > 2048) throw new Error('Valor demasiado grande');
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('almacenamiento seguro', () => {
  it('devuelve null si la clave no existe', async () => {
    expect(await getSecureItem('auth_token')).toBeNull();
  });

  it('guarda y recupera valores mayores que el límite de SecureStore', async () => {
    const session = JSON.stringify({ access_token: 'a'.repeat(3000), user: 'Técnico Ñandú' });

    await setSecureItem('auth_token', session);

    expect(await getSecureItem('auth_token')).toBe(session);
    expect(mockStore.get('auth_token.count')).toBe(String(Math.ceil(session.length / CHUNK_SIZE)));
  });

  it('ningún fragmento supera 2048 bytes aunque el texto tenga caracteres de 3 bytes', async () => {
    const value = '€'.repeat(2500);

    await setSecureItem('k', value);

    expect(await getSecureItem('k')).toBe(value);
    for (const [key, chunk] of mockStore) {
      if (!key.endsWith('.count')) {
        expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(2048);
      }
    }
  });

  it('elimina los fragmentos sobrantes al guardar un valor más corto', async () => {
    await setSecureItem('k', 'x'.repeat(CHUNK_SIZE * 3));
    await setSecureItem('k', 'corto');

    expect(await getSecureItem('k')).toBe('corto');
    expect([...mockStore.keys()].sort()).toEqual(['k.0', 'k.count']);
  });

  it('trata como inexistente un valor al que le falta un fragmento', async () => {
    await setSecureItem('k', 'x'.repeat(CHUNK_SIZE * 2));
    mockStore.delete('k.1');

    expect(await getSecureItem('k')).toBeNull();
  });

  it('removeSecureItem borra todos los fragmentos', async () => {
    await setSecureItem('k', 'x'.repeat(CHUNK_SIZE * 2 + 1));
    await removeSecureItem('k');

    expect(mockStore.size).toBe(0);
    expect(await getSecureItem('k')).toBeNull();
  });

  it('guarda la cadena vacía como un valor válido', async () => {
    await setSecureItem('k', '');
    expect(await getSecureItem('k')).toBe('');
    expect(splitIntoChunks('')).toEqual(['']);
  });

  it('usa solo claves válidas para SecureStore', async () => {
    await setSecureItem('auth_token', 'x'.repeat(CHUNK_SIZE + 1));
    const keys = jest.mocked(SecureStore.setItemAsync).mock.calls.map(([key]) => key);
    for (const key of keys) expect(key).toMatch(/^[\w.-]+$/);
  });
});
