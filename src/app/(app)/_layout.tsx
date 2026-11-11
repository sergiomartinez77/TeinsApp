import { Redirect, Stack } from 'expo-router';

import { SplashView } from '@/features/auth/components/SplashView';
import { DatabaseProvider } from '@/features/sync/components/DatabaseProvider';
import { useAuthStore } from '@/store/auth.store';
import { colors } from '@/theme';

/**
 * Rutas protegidas. Sin sesión (real o demo) se redirige al login.
 * Con sesión, abre la base local y arranca la sincronización en segundo plano.
 */
export default function AppLayout() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const isDemoMode = useAuthStore((state) => state.isDemoMode);

  if (status === 'checking') return <SplashView />;
  if (status === 'unauthenticated' || !user) return <Redirect href="/login" />;

  return (
    // La `key` reinicia el proveedor si cambia el usuario o el modo.
    <DatabaseProvider
      key={`${user.id}:${isDemoMode ? 'demo' : 'main'}`}
      userId={user.id}
      isDemo={isDemoMode}
    >
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </DatabaseProvider>
  );
}
