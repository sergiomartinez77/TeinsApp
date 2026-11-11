import type { StyleProp, ViewStyle } from 'react-native';

import { Badge } from '@/components/ui';
import { useSyncStatus } from '@/hooks/useSyncStatus';

/** Chip con el estado global de sincronización (icono + texto). */
export function SyncStateBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const { label, color, icon } = useSyncStatus();
  return <Badge label={label} color={color} icon={icon} style={style} testID="sync-state-badge" />;
}
