import { useEffect } from 'react';

import { appConfig, missingConfigKeys } from '@/constants/config';
import { startConnectivityMonitor } from '@/services/connectivity/connectivity.service';
import { onSessionEnded } from '@/services/supabase/auth.service';
import { registerAuthAutoRefresh } from '@/services/supabase/client';
import { useAuthStore } from '@/store/auth.store';

/**
 * Arranque de la sesión. Se usa una sola vez, en el layout raíz.
 *
 * 1. Empieza a vigilar la red.
 * 2. Revisa la sesión guardada en el dispositivo (sin esperar a la red).
 * 3. Mantiene el token fresco mientras la app está en primer plano.
 * 4. Reacciona si el servidor da la sesión por terminada.
 */
export function useSessionBootstrap(): void {
  useEffect(() => {
    startConnectivityMonitor();

    const { checkSession, handleSessionEnded } = useAuthStore.getState();
    void checkSession();

    // Sin configuración no hay cliente de Supabase: la pantalla de arranque lo avisa.
    if (missingConfigKeys(appConfig).length > 0) return undefined;

    const stopAutoRefresh = registerAuthAutoRefresh();
    const stopListening = onSessionEnded(handleSessionEnded);
    return () => {
      stopAutoRefresh();
      stopListening();
    };
  }, []);
}
