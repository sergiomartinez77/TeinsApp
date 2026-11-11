import type { StyleProp, ViewStyle } from 'react-native';

import { Badge } from '@/components/ui';
import {
  RECORD_SYNC_INFO,
  VISIT_STATUS_COLORS,
  VISIT_STATUS_LABELS,
  type RecordSyncStatus,
  type VisitStatus,
} from '@/models/visit.model';

/** Chip con el estado de negocio de la visita. */
export function VisitStatusBadge({
  status,
  style,
}: {
  status: VisitStatus;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Badge label={VISIT_STATUS_LABELS[status]} color={VISIT_STATUS_COLORS[status]} style={style} />
  );
}

/** Chip con el estado de sincronización de un registro (icono + texto). */
export function RecordSyncBadge({
  status,
  style,
}: {
  status: RecordSyncStatus;
  style?: StyleProp<ViewStyle>;
}) {
  const info = RECORD_SYNC_INFO[status];
  return <Badge label={info.label} color={info.color} icon={info.icon} style={style} />;
}
