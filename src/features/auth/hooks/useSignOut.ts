import { useCallback } from 'react';
import { Alert } from 'react-native';

import { useAuthStore } from '@/store/auth.store';
import { useSyncStore } from '@/store/sync.store';

/** Texto de confirmación según el modo y los cambios sin enviar. */
export function signOutMessage(isDemo: boolean, pendingCount: number): string {
  if (isDemo) {
    return 'Al salir del modo demo se borran los datos de ejemplo que hayas creado.';
  }
  if (pendingCount > 0) {
    const changes = pendingCount === 1 ? '1 cambio' : `${pendingCount} cambios`;
    return `Tienes ${changes} sin sincronizar. Se conservarán en este dispositivo y se enviarán cuando vuelvas a iniciar sesión con tu cuenta.`;
  }
  return '¿Quieres cerrar tu sesión en este dispositivo?';
}

/**
 * Devuelve la acción de cerrar sesión con confirmación previa.
 * Avisa si hay cambios sin sincronizar; esos cambios no se pierden.
 */
export function useSignOut(): () => void {
  const signOut = useAuthStore((state) => state.signOut);

  return useCallback(() => {
    const { isDemoMode } = useAuthStore.getState();
    const { pendingCount } = useSyncStore.getState();

    Alert.alert(
      isDemoMode ? 'Salir del modo demo' : 'Cerrar sesión',
      signOutMessage(isDemoMode, pendingCount),
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: isDemoMode ? 'Salir' : 'Cerrar sesión',
          style: 'destructive',
          onPress: () => void signOut(),
        },
      ],
    );
  }, [signOut]);
}
