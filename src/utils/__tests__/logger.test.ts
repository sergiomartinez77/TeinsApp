import { createLogger, redact, shouldLog } from '../logger';

describe('logger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('respeta el nivel configurado', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('error', 'warning')).toBe(true);
    expect(shouldLog('error', 'none')).toBe(false);
  });

  it('enmascara claves sensibles en cualquier nivel de anidación', () => {
    const result = redact({
      email: 'tecnico@example.com',
      password: 'secreto',
      session: { access_token: 'abc', refreshToken: 'def', user: { id: '1' } },
      items: [{ apiKey: 'k' }],
    });

    expect(result).toEqual({
      email: 'tecnico@example.com',
      password: '[oculto]',
      session: { access_token: '[oculto]', refreshToken: '[oculto]', user: { id: '1' } },
      items: [{ apiKey: '[oculto]' }],
    });
  });

  it('reduce los errores a nombre y mensaje', () => {
    expect(redact(new TypeError('falló'))).toEqual({ name: 'TypeError', message: 'falló' });
  });

  it('no escribe por debajo del nivel configurado', () => {
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const log = createLogger('error', 'test');
    log.debug('no debe salir');
    log.error('sí debe salir', { token: 'abc' });

    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[TEINS:test]', 'sí debe salir', { token: '[oculto]' });
  });
});
