import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, type IconName } from '@/components/ui';
import { visitTypeLabel, type Visit } from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { formatDateTime } from '@/utils/date.utils';

import { RecordSyncBadge, VisitStatusBadge } from './VisitStatusBadge';

/** Tarjeta con la información general de la visita (detalle y resumen). */
export function VisitInfoCard({ visit }: { visit: Visit }) {
  return (
    <Card style={styles.card} testID="visit-info-card">
      <View style={styles.header}>
        <AppText variant="titleLarge" accessibilityRole="header" style={styles.flex}>
          {visit.title}
        </AppText>
        <VisitStatusBadge status={visit.status} />
      </View>

      <Row icon="category" label="Tipo" value={visitTypeLabel(visit.visitType)} />
      {visit.clientName ? <Row icon="business" label="Cliente" value={visit.clientName} /> : null}
      {visit.address ? <Row icon="location-on" label="Dirección" value={visit.address} /> : null}
      {visit.description ? (
        <Row icon="notes" label="Descripción" value={visit.description} />
      ) : null}
      <Row icon="calendar-today" label="Creada" value={formatDateTime(visit.createdAt)} />
      {visit.startedAt ? (
        <Row icon="play-arrow" label="Iniciada" value={formatDateTime(visit.startedAt)} />
      ) : null}
      {visit.completedAt ? (
        <Row icon="check" label="Finalizada" value={formatDateTime(visit.completedAt)} />
      ) : null}

      <RecordSyncBadge status={visit.syncStatus} style={styles.sync} />
    </Card>
  );
}

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={18} color={colors.textSecondary} />
      <View style={styles.flex}>
        <AppText variant="labelMedium">{label}</AppText>
        <AppText variant="bodyMedium">{value}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm + 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  sync: {
    alignSelf: 'flex-end',
  },
});
