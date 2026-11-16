import { trackPendingWrite, waitForPendingWrites } from '../powersync/pending-writes';

jest.mock('@/utils/logger', () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger, scopedLogger: () => logger };
});

function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('escrituras pendientes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('no espera si no hay escrituras en curso', async () => {
    await expect(waitForPendingWrites()).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('espera a que terminen las escrituras, también si fallan', async () => {
    const first = deferred();
    const second = deferred();
    void trackPendingWrite(first.promise);
    trackPendingWrite(second.promise).catch(() => undefined);

    let finished = false;
    const waiting = waitForPendingWrites().then(() => {
      finished = true;
    });

    first.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    second.reject(new Error('fallo de escritura'));
    await waiting;
    expect(finished).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('espera también a una escritura registrada mientras esperaba', async () => {
    const first = deferred();
    const late = deferred();
    void trackPendingWrite(first.promise);

    let finished = false;
    const waiting = waitForPendingWrites().then(() => {
      finished = true;
    });

    void trackPendingWrite(late.promise);
    first.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);

    late.resolve();
    await waiting;
    expect(finished).toBe(true);
  });

  it('deja de esperar al agotarse el tiempo si una escritura no termina', async () => {
    const stuck = deferred();
    void trackPendingWrite(stuck.promise);

    let finished = false;
    const waiting = waitForPendingWrites(10_000).then(() => {
      finished = true;
    });

    await jest.advanceTimersByTimeAsync(9_999);
    expect(finished).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await waiting;
    expect(finished).toBe(true);

    // Limpieza: la escritura colgada termina para no afectar a otros tests.
    stuck.resolve();
    await Promise.resolve();
  });
});
