import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { SECURE_KEYS } from '@/constants/app.constants';
import { appConfig, missingConfigKeys } from '@/constants/config';
import { secureStorageAdapter } from '@/services/storage/secure-storage';

let client: SupabaseClient | null = null;

/**
 * Cliente único de Supabase.
 *
 * - Solo usa la clave pública `anon` (nunca la `service_role`).
 * - La sesión se guarda cifrada en SecureStore y se recupera al arrancar.
 * - Flujo PKCE, igual que la app original.
 *
 * Se crea de forma diferida para que una configuración incompleta se muestre
 * como aviso en la pantalla de arranque en lugar de romper la app al cargar.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const missing = missingConfigKeys(appConfig);
  if (missing.length > 0) {
    throw new Error(`Configuración incompleta: ${missing.join(', ')}`);
  }

  client = createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
    auth: {
      storage: secureStorageAdapter,
      storageKey: SECURE_KEYS.authSession,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      // En móvil no hay URL de retorno que inspeccionar.
      detectSessionInUrl: false,
    },
  });
  return client;
}

/**
 * Refresca el token solo mientras la app está en primer plano.
 * Devuelve la función para dejar de escuchar.
 */
export function registerAuthAutoRefresh(supabase: SupabaseClient = getSupabase()): () => void {
  const apply = (status: string | null | undefined) => {
    if (status === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };

  apply(AppState.currentState);
  const subscription = AppState.addEventListener('change', apply);
  return () => {
    subscription.remove();
    void supabase.auth.stopAutoRefresh();
  };
}
