import { scopedLogger } from '@/utils/logger';

/**
 * Escrituras locales en curso que deben terminar antes de cerrar la base.
 *
 * Al cerrar la sesión (o si el servidor la da por terminada) las pantallas se
 * desmontan y su autoguardado escribe lo pendiente. El cierre de la base
 * espera a esas escrituras para no perder el último cambio del técnico.
 */

const log = scopedLogger('db');

/** Tiempo máximo de espera: una escritura colgada no debe bloquear el cierre. */
export const PENDING_WRITES_TIMEOUT_MS = 10_000;

const pending = new Set<Promise<unknown>>();

/** Registra una escritura en curso. Devuelve la misma promesa. */
export function trackPendingWrite<T>(write: Promise<T>): Promise<T> {
  pending.add(write);
  const done = () => {
    pending.delete(write);
  };
  write.then(done, done);
  return write;
}

async function drain(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

/**
 * Espera a que terminen (bien o mal) todas las escrituras registradas.
 * Si no terminan en `timeoutMs`, deja de esperar y lo registra en el log:
 * sin ese tope, una escritura que nunca acabara impediría cerrar la base
 * y, con ello, volver a iniciar sesión.
 */
export async function waitForPendingWrites(
  timeoutMs: number = PENDING_WRITES_TIMEOUT_MS,
): Promise<void> {
  if (pending.size === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });

  const expired = await Promise.race([drain().then(() => false), timedOut]);
  clearTimeout(timer);

  if (expired) {
    log.warn('Se agotó la espera de escrituras pendientes; la base se cierra igualmente', {
      pendientes: pending.size,
    });
  }
}
