import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useAutosave } from '../hooks/useAutosave';

const setup = async (save = jest.fn(async (_value: string) => true)) => {
  const hook = await renderHook(() => useAutosave<string>({ save }));
  return { ...hook, save };
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useAutosave', () => {
  it('no guarda antes de 800 ms', async () => {
    const { result, save } = await setup();

    await act(async () => result.current.schedule('a'));
    await act(async () => {
      jest.advanceTimersByTime(799);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('un cambio reinicia la espera y se guarda una sola vez con el último valor', async () => {
    const { result, save } = await setup();

    await act(async () => result.current.schedule('a'));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await act(async () => result.current.schedule('ab'));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('ab');
    expect(result.current.status).toBe('saved');
  });

  it('guarda de inmediato al desmontar si hay cambios pendientes', async () => {
    const { result, save, unmount } = await setup();

    await act(async () => result.current.schedule('pendiente'));
    await unmount();

    expect(save).toHaveBeenCalledWith('pendiente');
    jest.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('no guarda si no hay cambios', async () => {
    const { result, save, unmount } = await setup();

    await act(async () => result.current.flush());
    await unmount();

    expect(save).not.toHaveBeenCalled();
  });

  it('guarda al pasar la app a segundo plano', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler;
      return { remove: jest.fn() };
    });
    const { result, save } = await setup();

    await act(async () => result.current.schedule('fondo'));
    await act(async () => listener?.('background'));

    expect(save).toHaveBeenCalledWith('fondo');
  });

  it('si el guardado falla muestra el error y reintenta con el siguiente guardado', async () => {
    const save = jest.fn(async (_value: string) => false);
    const { result } = await setup(save);

    await act(async () => result.current.schedule('x'));
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    expect(result.current.status).toBe('error');

    save.mockResolvedValueOnce(true);
    await act(async () => result.current.flush());

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('x');
    expect(result.current.status).toBe('saved');
  });

  it('cancelar descarta el cambio pendiente', async () => {
    const { result, save } = await setup();

    await act(async () => result.current.schedule('a'));
    await act(async () => result.current.cancel());
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(save).not.toHaveBeenCalled();
  });
});
