import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import {
  checkOnline,
  isOnline,
  isOnlineState,
  stopConnectivityMonitor,
  subscribeConnectivity,
} from '../connectivity/connectivity.service';

type NetListener = (state: NetInfoState) => void;

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(),
    fetch: jest.fn(),
  },
}));

const netInfo = jest.mocked(NetInfo);
const state = (isConnected: boolean | null, isInternetReachable: boolean | null) =>
  ({ isConnected, isInternetReachable }) as NetInfoState;

describe('isOnlineState', () => {
  it('considera en línea una red conectada con Internet confirmado o por confirmar', () => {
    expect(isOnlineState(state(true, true))).toBe(true);
    expect(isOnlineState(state(true, null))).toBe(true);
  });

  it('considera sin conexión el resto de casos', () => {
    expect(isOnlineState(state(true, false))).toBe(false);
    expect(isOnlineState(state(false, false))).toBe(false);
    expect(isOnlineState(state(null, null))).toBe(false);
  });
});

describe('monitor de conectividad', () => {
  let emit: NetListener = () => undefined;
  const unsubscribe = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    stopConnectivityMonitor();
    netInfo.addEventListener.mockImplementation((listener) => {
      emit = listener;
      return unsubscribe;
    });
  });

  it('avisa solo cuando el estado cambia y se registra una única vez en la red', () => {
    const first = jest.fn();
    const second = jest.fn();
    const cancelFirst = subscribeConnectivity(first);
    subscribeConnectivity(second);

    expect(netInfo.addEventListener).toHaveBeenCalledTimes(1);

    emit(state(true, true));
    expect(first).not.toHaveBeenCalled();

    emit(state(false, false));
    expect(isOnline()).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    cancelFirst();
    emit(state(true, true));
    expect(isOnline()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('checkOnline consulta el estado actual', async () => {
    netInfo.fetch.mockResolvedValue(state(false, false));
    expect(await checkOnline()).toBe(false);

    netInfo.fetch.mockResolvedValue(state(true, null));
    expect(await checkOnline()).toBe(true);
  });
});
