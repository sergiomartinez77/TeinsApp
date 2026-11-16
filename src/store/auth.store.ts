import { create } from 'zustand';

import { DEMO_USER, type UserProfile } from '@/models/user.model';
import * as authService from '@/services/supabase/auth.service';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('auth');

/**
 * `checking`: aún no se sabe si hay sesión guardada (arranque).
 * `authenticated` / `unauthenticated`: estado resuelto.
 */
export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  user: UserProfile | null;
  /** Modo demo: usuario ficticio, sin servidor y sin persistencia de sesión. */
  isDemoMode: boolean;
  /** Hay un inicio o cierre de sesión en curso. */
  isSubmitting: boolean;
  /** Mensaje de error en español para mostrar en el login. */
  error: string | null;

  /** Revisa la sesión guardada en el dispositivo. No usa la red. */
  checkSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  enterDemoMode: () => void;
  signOut: () => Promise<void>;
  /** La sesión terminó por decisión del servidor (p. ej. expiró). */
  handleSessionEnded: () => void;
  clearError: () => void;
}

const SIGNED_OUT = {
  status: 'unauthenticated',
  user: null,
  isDemoMode: false,
  isSubmitting: false,
} as const;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'checking',
  user: null,
  isDemoMode: false,
  isSubmitting: false,
  error: null,

  checkSession: async () => {
    try {
      const user = await authService.getStoredUser();
      if (user) {
        set({ status: 'authenticated', user, isDemoMode: false, error: null });
      } else {
        set({ ...SIGNED_OUT, error: null });
      }
    } catch (error) {
      log.error('No se pudo leer la sesión guardada', error);
      set({ ...SIGNED_OUT, error: null });
    }
  },

  signIn: async (email, password) => {
    if (get().isSubmitting) return false;
    set({ isSubmitting: true, error: null });

    const result = await authService.signIn(email, password);
    if (result.ok) {
      set({
        status: 'authenticated',
        user: result.data,
        isDemoMode: false,
        isSubmitting: false,
        error: null,
      });
      return true;
    }

    set({ ...SIGNED_OUT, error: result.error.message });
    return false;
  },

  enterDemoMode: () => {
    set({
      status: 'authenticated',
      user: DEMO_USER,
      isDemoMode: true,
      isSubmitting: false,
      error: null,
    });
  },

  signOut: async () => {
    if (get().isSubmitting) return;
    const wasDemo = get().isDemoMode;
    set({ isSubmitting: true });
    try {
      // El modo demo no tiene sesión real que cerrar.
      if (!wasDemo) await authService.signOut();
    } catch (error) {
      // La sesión se da por cerrada igualmente: el fallo solo queda en el log.
      log.error('No se pudo borrar la sesión guardada en el dispositivo', error);
    } finally {
      set({ ...SIGNED_OUT, error: null });
    }
  },

  handleSessionEnded: () => {
    const { status, isDemoMode, isSubmitting } = get();
    // Se ignora en modo demo y durante un cierre de sesión iniciado por el usuario.
    if (status !== 'authenticated' || isDemoMode || isSubmitting) return;
    void authService
      .clearStoredProfile()
      .catch((error: unknown) => log.error('No se pudo borrar el perfil guardado', error));
    set({ ...SIGNED_OUT, error: authService.AUTH_MESSAGES.sessionExpired });
  },

  clearError: () => set({ error: null }),
}));
