import type { UserProfile } from '@/models/user.model';
import { useAuthStore } from '@/store/auth.store';

/** Usuario autenticado, o `null` si no hay sesión. */
export function useCurrentUser(): UserProfile | null {
  return useAuthStore((state) => state.user);
}

/**
 * Usuario autenticado para pantallas protegidas.
 * Las rutas de `(app)` solo se muestran con sesión, así que ahí siempre existe.
 */
export function useRequiredUser(): UserProfile {
  const user = useCurrentUser();
  if (!user) throw new Error('Esta pantalla requiere una sesión activa.');
  return user;
}
