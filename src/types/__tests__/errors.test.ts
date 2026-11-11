import {
  appError,
  DEFAULT_ERROR_MESSAGES,
  err,
  isAppError,
  ok,
  toAppError,
  validationError,
} from '../errors';

describe('errores tipados', () => {
  it('usa el mensaje por defecto en español de cada tipo', () => {
    expect(appError('network').message).toBe(DEFAULT_ERROR_MESSAGES.network);
    expect(appError('authentication').message).toMatch(/Credenciales incorrectas/);
    expect(appError('sync', { message: 'Otro texto' }).message).toBe('Otro texto');
  });

  it('ningún mensaje por defecto contiene jerga técnica', () => {
    for (const message of Object.values(DEFAULT_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/exception|null|undefined|SQL|JWT|HTTP|stack/i);
    }
  });

  it('convierte valores desconocidos sin perder la causa', () => {
    const cause = new Error('boom');
    const converted = toAppError(cause, 'database');

    expect(converted.kind).toBe('database');
    expect(converted.cause).toBe(cause);
    expect(converted.message).toBe(DEFAULT_ERROR_MESSAGES.database);
  });

  it('respeta los errores ya tipados', () => {
    const original = validationError('La cantidad debe ser mayor que cero.');
    expect(toAppError(original)).toBe(original);
    expect(isAppError(original)).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it('Result distingue éxito y fallo', () => {
    const success = ok(42);
    const failure = err(appError('unknown'));

    expect(success).toEqual({ ok: true, data: 42 });
    expect(failure.ok).toBe(false);
  });
});
