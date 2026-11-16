import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ComponentType,
} from 'react';

/**
 * Sustituto de `expo-router` para los tests de pantallas: una pila de rutas
 * en memoria. No reproduce las animaciones ni los layouts anidados de
 * Expo Router; sirve para comprobar a dónde navega cada pantalla.
 *
 *   jest.mock('expo-router', () => jest.requireActual('@/test-utils/fake-router'));
 *
 * Las pantallas se montan de dos formas: con `useCurrentRoute()` desde el
 * propio test, o registrando las rutas con `registerRoutes()` para que los
 * `<Stack>` reales de los layouts monten el layout del grupo y la pantalla.
 */

export interface FakeRoute {
  /** Ruta con sus segmentos dinámicos sin resolver, p. ej. `/visits/[visitId]`. */
  pathname: string;
  params: Record<string, string | undefined>;
}

type Href = string | { pathname: string; params?: Record<string, string | undefined> };

let stack: FakeRoute[] = [{ pathname: '/', params: {} }];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const toRoute = (href: Href): FakeRoute =>
  typeof href === 'string'
    ? { pathname: href, params: {} }
    : { pathname: href.pathname, params: { ...href.params } };

/** Reinicia la pila con una sola ruta (llamar en `beforeEach`). */
export function resetFakeRouter(initial: Href = '/'): void {
  stack = [toRoute(initial)];
  emit();
}

/** Pila actual, de la primera a la última pantalla. */
export function routeStack(): readonly FakeRoute[] {
  return stack;
}

export function currentRoute(): FakeRoute {
  return stack[stack.length - 1] ?? { pathname: '/', params: {} };
}

export const router = {
  push: jest.fn((href: Href) => {
    stack = [...stack, toRoute(href)];
    emit();
  }),
  navigate: jest.fn((href: Href) => {
    const route = toRoute(href);
    const index = stack.findIndex((item) => item.pathname === route.pathname);
    stack = index >= 0 ? [...stack.slice(0, index), route] : [...stack, route];
    emit();
  }),
  replace: jest.fn((href: Href) => {
    stack = [...stack.slice(0, -1), toRoute(href)];
    emit();
  }),
  back: jest.fn(() => {
    if (stack.length > 1) stack = stack.slice(0, -1);
    emit();
  }),
  canGoBack: jest.fn(() => stack.length > 1),
  setParams: jest.fn((params: Record<string, string | undefined>) => {
    const top = currentRoute();
    stack = [...stack.slice(0, -1), { ...top, params: { ...top.params, ...params } }];
    emit();
  }),
  dismissAll: jest.fn(),
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Ruta visible; el componente se vuelve a pintar al navegar. */
export function useCurrentRoute(): FakeRoute {
  return useSyncExternalStore(subscribe, currentRoute);
}

export function useRouter() {
  return router;
}

export function useLocalSearchParams<T>(): T {
  return useCurrentRoute().params as T;
}

/** Igual que `<Redirect>`: reemplaza la ruta actual al montarse. */
export function Redirect({ href }: { href: Href }) {
  useEffect(() => {
    router.replace(href);
  }, [href]);
  return null;
}

/** Pantalla de una ruta y, si pertenece a un grupo, el layout del grupo. */
export interface FakeRouteEntry {
  layout?: ComponentType;
  screen: ComponentType;
}

let routes: Readonly<Record<string, FakeRouteEntry>> = {};
const StackDepth = createContext(0);

/** Rutas que montan los `<Stack>` (por `pathname` sin resolver). */
export function registerRoutes(map: Readonly<Record<string, FakeRouteEntry>>): void {
  routes = map;
}

/**
 * `<Stack>` simplificado: el del layout raíz monta el layout del grupo de la
 * ruta visible (o la pantalla si no tiene grupo); el del grupo, la pantalla.
 */
export function Stack() {
  const depth = useContext(StackDepth);
  const route = useCurrentRoute();
  const entry = routes[route.pathname];
  if (!entry) return null;
  if (depth === 0 && entry.layout) {
    return createElement(StackDepth.Provider, { value: 1 }, createElement(entry.layout));
  }
  return createElement(entry.screen, { key: `${route.pathname}:${JSON.stringify(route.params)}` });
}
