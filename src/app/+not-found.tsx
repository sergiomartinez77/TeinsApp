import { useRouter } from 'expo-router';

import { NotFoundView } from '@/components/layout/NotFoundView';

/** Ruta desconocida: aviso en español y vuelta al inicio. */
export default function NotFoundScreen() {
  const router = useRouter();
  return <NotFoundView onGoHome={() => router.replace('/')} />;
}
