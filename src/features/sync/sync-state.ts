import type { IconName } from '@/components/ui/Icon';
import { colors } from '@/theme';

/**
 * Estado de sincronización que se muestra al técnico.
 * `demo` se añade a los cinco del original: en modo demo nada se sincroniza.
 */
export type SyncState = 'offline' | 'syncing' | 'pending' | 'synced' | 'error' | 'demo';

export interface SyncInputs {
  isDemo: boolean;
  /** Conectividad del dispositivo. */
  isOnline: boolean;
  /** Conexión establecida con el servicio de sincronización. */
  connected: boolean;
  connecting: boolean;
  uploading: boolean;
  downloading: boolean;
  hasError: boolean;
  /** Cambios locales aún sin subir. */
  pendingCount: number;
}

/**
 * Decide el estado visible. Reglas en orden de prioridad:
 * 1. Modo demo → `demo`.
 * 2. Sin red → `offline`. Es un estado normal: los errores de conexión
 *    que ocurren por no tener red no se muestran como error.
 * 3. Transfiriendo datos o conectando → `syncing`.
 * 4. Con red pero con fallo de sincronización → `error`.
 * 5. Cambios por subir → `pending`.
 * 6. Todo al día → `synced`.
 */
export function deriveSyncState(inputs: SyncInputs): SyncState {
  if (inputs.isDemo) return 'demo';
  if (!inputs.isOnline) return 'offline';
  if (inputs.uploading || inputs.downloading) return 'syncing';
  if (inputs.hasError) return 'error';
  if (inputs.connecting || !inputs.connected) return 'syncing';
  if (inputs.pendingCount > 0) return 'pending';
  return 'synced';
}

export interface SyncStateInfo {
  /** Etiqueta corta para badges. */
  label: string;
  /** Explicación para la tarjeta del dashboard. */
  description: string;
  color: string;
  icon: IconName;
}

function pendingLabel(count: number): string {
  return count === 1 ? '1 pendiente' : `${count} pendientes`;
}

/** Textos, color e icono de cada estado. Siempre en español y sin jerga. */
export function describeSyncState(state: SyncState, pendingCount: number): SyncStateInfo {
  switch (state) {
    case 'demo':
      return {
        label: 'Modo demo',
        description: 'Estás usando datos de ejemplo. Nada de lo que hagas se envía al servidor.',
        color: colors.warning,
        icon: 'info',
      };
    case 'offline':
      return {
        label: 'Sin conexión',
        description:
          pendingCount > 0
            ? `Trabajando sin conexión. ${pendingLabel(pendingCount)} de enviar; se sincronizarán solos al volver Internet.`
            : 'Trabajando sin conexión. Tus cambios se guardan en el dispositivo.',
        color: colors.offline,
        icon: 'cloud-off',
      };
    case 'syncing':
      return {
        label: 'Sincronizando',
        description: 'Enviando y recibiendo información...',
        color: colors.syncing,
        icon: 'sync',
      };
    case 'pending':
      return {
        label: pendingLabel(pendingCount),
        description: `${pendingCount === 1 ? 'Hay 1 cambio' : `Hay ${pendingCount} cambios`} por enviar. Se sincronizarán automáticamente.`,
        color: colors.pendingSync,
        icon: 'cloud-upload',
      };
    case 'error':
      return {
        label: 'Error de sincronización',
        description:
          'No se pudo sincronizar. Tus datos siguen guardados en el dispositivo y se reintentará automáticamente.',
        color: colors.error,
        icon: 'sync-problem',
      };
    case 'synced':
      return {
        label: 'Sincronizado',
        description: 'Toda tu información está al día.',
        color: colors.synced,
        icon: 'cloud-done',
      };
  }
}
