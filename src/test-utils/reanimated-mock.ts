/**
 * Sustituto mínimo de `react-native-reanimated` para los tests que pintan
 * con Skia valores compartidos (el módulo real necesita el motor nativo de
 * worklets). Los valores llevan la marca `_isReanimatedSharedValue`, así que
 * Skia los lee con `.value` como en el dispositivo. Los valores derivados se
 * calculan al pintar (no se vuelven a calcular solos).
 *
 * Uso: `jest.mock('react-native-reanimated', () =>
 *   jest.requireActual('@/test-utils/reanimated-mock').reanimatedMock())`.
 */

export interface MockSharedValue<T> {
  value: T;
  get: () => T;
  set: (value: T) => void;
  readonly _isReanimatedSharedValue: true;
}

export function mockSharedValue<T>(initial: T): MockSharedValue<T> {
  const shared: MockSharedValue<T> = {
    value: initial,
    get: () => shared.value,
    set: (value: T) => {
      shared.value = value;
    },
    _isReanimatedSharedValue: true,
  };
  return shared;
}

export function reanimatedMock() {
  const { useRef } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  function useSharedValue<T>(initial: T): MockSharedValue<T> {
    const ref = useRef<MockSharedValue<T> | null>(null);
    ref.current ??= mockSharedValue(initial);
    return ref.current;
  }

  function useDerivedValue<T>(compute: () => T): MockSharedValue<T> {
    const shared = useSharedValue(compute());
    shared.value = compute();
    return shared;
  }

  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    useSharedValue,
    useDerivedValue,
    useAnimatedStyle: (compute: () => unknown) => compute(),
    withTiming: <T>(value: T) => value,
    // Lo que usa react-native-gesture-handler cuando detecta Reanimated.
    isSharedValue: (value: unknown) =>
      typeof value === 'object' && value !== null && '_isReanimatedSharedValue' in value,
    useEvent: () => undefined,
    useHandler: () => ({ context: {}, doDependenciesDiffer: false, useWeb: false }),
    useComposedEventHandler: () => undefined,
    setGestureState: () => undefined,
  };
}
