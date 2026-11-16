import type { QueryClient } from '@tanstack/react-query';

import { useAuthStore, type AuthState } from '@/store/auth.store';

/** Identifica la sesión activa: usuario y modo. `null` sin sesión. */
function sessionKey(state: Pick<AuthState, 'status' | 'user' | 'isDemoMode'>): string | null {
  if (state.status !== 'authenticated' || !state.user) return null;
  return `${state.user.id}:${state.isDemoMode ? 'demo' : 'main'}`;
}

/**
 * Vacía la caché de TanStack Query cada vez que cambia la sesión: al cerrarla
 * (también si el servidor la da por terminada), al cambiar de usuario y al
 * entrar o salir del modo demo. Así ninguna URL firmada de fotos ni mutación
 * de una sesión queda disponible en la siguiente.
 *
 * Es el único punto donde se limpia la caché. Devuelve la función para dejar
 * de escuchar.
 */
export function clearQueryCacheOnSessionChange(queryClient: QueryClient): () => void {
  let current = sessionKey(useAuthStore.getState());
  return useAuthStore.subscribe((state) => {
    const next = sessionKey(state);
    if (next === current) return;
    current = next;
    queryClient.clear();
  });
}
