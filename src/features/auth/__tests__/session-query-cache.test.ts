import { QueryClient } from '@tanstack/react-query';

import { DEMO_USER, type UserProfile } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';

import { clearQueryCacheOnSessionChange } from '../session-query-cache';

jest.mock('@/services/supabase/auth.service', () => ({
  AUTH_MESSAGES: { sessionExpired: 'Tu sesión ha expirado.' },
  clearStoredProfile: jest.fn(async () => undefined),
}));

const USER: UserProfile = { ...DEMO_USER, id: 'user-1' };
const OTHER: UserProfile = { ...USER, id: 'user-2' };

function signedIn(user: UserProfile, isDemoMode = false) {
  useAuthStore.setState({ status: 'authenticated', user, isDemoMode, isSubmitting: false });
}

function seed(queryClient: QueryClient) {
  queryClient.setQueryData(['photo-signed-url', 'visita/foto.jpg'], 'https://firmada');
  queryClient
    .getMutationCache()
    .build(queryClient, { mutationKey: ['guardar'], mutationFn: async () => undefined });
}

const isEmpty = (queryClient: QueryClient) =>
  queryClient.getQueryCache().getAll().length === 0 &&
  queryClient.getMutationCache().getAll().length === 0;

let queryClient: QueryClient;
let stop: () => void;

beforeEach(() => {
  // Sin recolección diferida: los temporizadores no mantienen vivo el proceso de Jest.
  queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  signedIn(USER);
  stop = clearQueryCacheOnSessionChange(queryClient);
  seed(queryClient);
});

afterEach(() => {
  stop();
  queryClient.clear();
  useAuthStore.setState({ status: 'checking', user: null, isDemoMode: false, error: null });
});

describe('clearQueryCacheOnSessionChange', () => {
  it('vacía consultas y mutaciones al cerrar la sesión', () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    expect(isEmpty(queryClient)).toBe(true);
  });

  it('vacía la caché cuando el servidor da la sesión por terminada', () => {
    useAuthStore.getState().handleSessionEnded();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(isEmpty(queryClient)).toBe(true);
  });

  it('vacía la caché al cambiar de usuario o de modo', () => {
    signedIn(OTHER);
    expect(isEmpty(queryClient)).toBe(true);

    seed(queryClient);
    signedIn(OTHER, true);
    expect(isEmpty(queryClient)).toBe(true);
  });

  it('no toca la caché si cambia algo que no es la sesión', () => {
    useAuthStore.setState({ isSubmitting: true, error: 'algo' });
    expect(queryClient.getQueryData(['photo-signed-url', 'visita/foto.jpg'])).toBe(
      'https://firmada',
    );
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
  });

  it('deja de escuchar al detenerse', () => {
    stop();
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });
});
