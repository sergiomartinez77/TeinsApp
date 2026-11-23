import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon } from '@/components/ui';
import { hasPendingSync, isOwnVisit, visitTypeLabel, type Visit } from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { formatRelative } from '@/utils/date.utils';

import { RecordSyncBadge, VisitStatusBadge } from './VisitStatusBadge';

export interface VisitCardProps {
  visit: Visit;
  onPress: (visitId: string) => void;
  /** Usuario conectado: en las visitas de otros técnicos se muestra el técnico. */
  currentUserId?: string;
}

/** Tarjeta de una visita en el listado. */
export function VisitCard({ visit, onPress, currentUserId }: VisitCardProps) {
  const technician =
    currentUserId !== undefined && !isOwnVisit(visit, currentUserId)
      ? `Técnico: ${visit.technicianName ?? 'otro técnico'}`
      : null;
  return (
    <Card
      onPress={() => onPress(visit.id)}
      accessibilityLabel={`Abrir visita ${visit.title}`}
      style={styles.card}
      testID={`visit-card-${visit.id}`}
    >
      <View style={styles.header}>
        <AppText variant="titleSmall" numberOfLines={2} style={styles.title}>
          {visit.title}
        </AppText>
        <VisitStatusBadge status={visit.status} />
      </View>

      <Detail icon="category" text={visitTypeLabel(visit.visitType)} />
      {visit.clientName ? <Detail icon="business" text={visit.clientName} /> : null}
      {visit.address ? <Detail icon="location-on" text={visit.address} /> : null}
      {technician ? <Detail icon="person" text={technician} /> : null}

      <View style={styles.footer}>
        <AppText variant="bodySmall" style={styles.title}>
          Creada {formatRelative(visit.createdAt)}
        </AppText>
        {hasPendingSync(visit) ? <RecordSyncBadge status={visit.syncStatus} /> : null}
      </View>
    </Card>
  );
}

function Detail({
  icon,
  text,
}: {
  icon: 'category' | 'business' | 'location-on' | 'person';
  text: string;
}) {
  return (
    <View style={styles.detail}>
      <Icon name={icon} size={16} color={colors.textSecondary} />
      <AppText variant="bodySmall" numberOfLines={1} style={styles.title}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs + 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
