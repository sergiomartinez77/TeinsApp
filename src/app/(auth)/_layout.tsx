import { Redirect, Stack } from 'expo-router';

import { SplashView } from '@/features/auth/components/SplashView';
import { useAuthStore } from '@/store/auth.store';
import { colors } from '@/theme';

/** Rutas públicas. Con sesión activa se redirige al dashboard. */
export default function AuthLayout() {
  const status = useAuthStore((state) => state.status);

  if (status === 'checking') return <SplashView />;
  if (status === 'authenticated') return <Redirect href="/home" />;

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
