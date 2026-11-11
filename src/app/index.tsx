import { Redirect } from 'expo-router';

import { appConfig, missingConfigKeys } from '@/constants/config';
import { SplashView } from '@/features/auth/components/SplashView';
import { useAuthStore } from '@/store/auth.store';

/**
 * Ruta `/` — arranque.
 * Espera a saber si hay sesión guardada (lectura local, sin red) y redirige
 * al dashboard o al login.
 */
export default function StartupScreen() {
  const status = useAuthStore((state) => state.status);
  const missing = missingConfigKeys(appConfig);

  if (status === 'authenticated') return <Redirect href="/home" />;
  if (missing.length > 0) return <SplashView missingConfig={missing} />;
  if (status === 'unauthenticated') return <Redirect href="/login" />;
  return <SplashView />;
}
