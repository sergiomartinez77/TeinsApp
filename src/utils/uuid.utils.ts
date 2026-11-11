import { randomUUID } from 'expo-crypto';

/**
 * Identificador UUID v4 generado en el dispositivo.
 * Todos los registros nuevos lo usan para poder crearse sin conexión.
 */
export function generateId(): string {
  return randomUUID();
}
