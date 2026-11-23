import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorScreen } from '@/components/layout/AppErrorScreen';
import { clearAssistantOnSessionChange } from '@/features/assistant/assistant.store';
import { useSessionBootstrap } from '@/features/auth/hooks/useSessionBootstrap';
import { clearQueryCacheOnSessionChange } from '@/features/auth/session-query-cache';
import { colors } from '@/theme';

/** Pantalla de error global: cualquier fallo no controlado de la interfaz llega aquí. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorScreen {...props} />;
}

/** Layout raíz: proveedores globales, arranque de sesión y navegador principal. */
export default function RootLayout() {
  // Las acciones locales no se reintentan solas: escriben en SQLite y no dependen de la red.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
  );

  useSessionBootstrap();
  // Al cerrar sesión o cambiar de usuario o de modo se vacía la caché de consultas.
  useEffect(() => clearQueryCacheOnSessionChange(queryClient), [queryClient]);
  // La conversación del asistente tampoco pasa de una sesión a otra.
  useEffect(() => clearAssistantOnSessionChange(), []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
