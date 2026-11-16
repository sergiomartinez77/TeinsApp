import { err, toAppError, type Result } from '@/types/errors';

import { scopedLogger } from './logger';

const log = scopedLogger('app');

/**
 * Espera un `Result` y nunca lanza: si la operación lanza algo inesperado
 * (no debería, los servicios devuelven `Result`), se registra en el log y se
 * convierte en un `AppError` con un mensaje apto para el usuario.
 */
export async function settleResult<T>(operation: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await operation;
  } catch (error) {
    log.error('Una operación falló de forma inesperada', error);
    return err(toAppError(error));
  }
}

/**
 * Para `mutationFn`: devuelve los datos o lanza el `AppError`, de modo que la
 * mutación lo trate como error. Lo lanzado es siempre un `AppError`: su
 * `message` se puede mostrar tal cual.
 */
export async function unwrapResult<T>(operation: Promise<Result<T>>): Promise<T> {
  const settled = await settleResult(operation);
  if (!settled.ok) throw settled.error;
  return settled.data;
}

/** Mensaje para el usuario de cualquier error capturado; nunca un texto técnico. */
export function userErrorMessage(error: unknown): string {
  return toAppError(error).message;
}
