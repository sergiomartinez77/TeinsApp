import { appError, DEFAULT_ERROR_MESSAGES, err, ok } from '@/types/errors';

import { settleResult, unwrapResult, userErrorMessage } from '../result.utils';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('unwrapResult', () => {
  it('devuelve los datos de un resultado correcto', async () => {
    await expect(unwrapResult(Promise.resolve(ok(5)))).resolves.toBe(5);
  });

  it('lanza el AppError de un resultado fallido', async () => {
    const error = appError('database');
    await expect(unwrapResult(Promise.resolve(err(error)))).rejects.toBe(error);
  });

  it('convierte en AppError lo que se lance de forma inesperada', async () => {
    const thrown = unwrapResult(Promise.reject(new Error('SQLITE_BUSY: database is locked')));
    await expect(thrown).rejects.toMatchObject({
      kind: 'unknown',
      message: DEFAULT_ERROR_MESSAGES.unknown,
    });
  });
});

describe('settleResult', () => {
  it('nunca lanza', async () => {
    const settled = await settleResult(Promise.reject(new Error('fallo')));
    expect(settled.ok).toBe(false);
  });
});

describe('userErrorMessage', () => {
  it('nunca devuelve el texto técnico de un Error', () => {
    expect(userErrorMessage(new Error('JSON Parse error: Unexpected token'))).toBe(
      DEFAULT_ERROR_MESSAGES.unknown,
    );
    expect(userErrorMessage(appError('storage'))).toBe(DEFAULT_ERROR_MESSAGES.storage);
  });
});
