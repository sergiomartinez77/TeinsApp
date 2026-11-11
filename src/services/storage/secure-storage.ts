import * as SecureStore from 'expo-secure-store';

/**
 * Almacenamiento seguro (Keystore en Android, Keychain en iOS).
 *
 * SecureStore admite como máximo ~2 KB por clave y la sesión de Supabase
 * supera ese tamaño, así que los valores se guardan partidos en fragmentos:
 *
 *   <clave>.count  → número de fragmentos
 *   <clave>.0 … <clave>.N-1 → fragmentos
 *
 * Los tokens nunca se guardan en almacenamiento sin cifrar.
 */

/**
 * Caracteres por fragmento. Un carácter ocupa como máximo 3 bytes en UTF-8,
 * así que 600 caracteres nunca superan el límite de 2048 bytes.
 */
export const CHUNK_SIZE = 600;

const countKey = (key: string) => `${key}.count`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

export function splitIntoChunks(value: string, size: number = CHUNK_SIZE): string[] {
  if (value.length === 0) return [''];
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const count = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export async function getSecureItem(key: string): Promise<string | null> {
  const count = await readCount(key);
  if (count === 0) return null;

  const chunks = await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))),
  );
  // Si falta algún fragmento el valor está dañado: se trata como inexistente.
  if (chunks.some((chunk) => chunk === null)) return null;
  return chunks.join('');
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  const previousCount = await readCount(key);
  const chunks = splitIntoChunks(value);

  // Se invalida el contador antes de escribir: si la app se cierra a mitad
  // de la escritura, la lectura devuelve "sin valor" en vez de un valor mezclado.
  await SecureStore.deleteItemAsync(countKey(key));
  await Promise.all(
    chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
  );
  await SecureStore.setItemAsync(countKey(key), String(chunks.length));

  // Limpia fragmentos sobrantes de un valor anterior más largo.
  const leftovers: Promise<void>[] = [];
  for (let index = chunks.length; index < previousCount; index += 1) {
    leftovers.push(SecureStore.deleteItemAsync(chunkKey(key, index)));
  }
  await Promise.all(leftovers);
}

export async function removeSecureItem(key: string): Promise<void> {
  const count = await readCount(key);
  await SecureStore.deleteItemAsync(countKey(key));
  await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index))),
  );
}

/** Adaptador con la interfaz de almacenamiento que espera el cliente de Supabase. */
export const secureStorageAdapter = {
  getItem: getSecureItem,
  setItem: setSecureItem,
  removeItem: removeSecureItem,
} as const;
