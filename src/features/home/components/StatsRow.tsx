import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, type IconName } from '@/components/ui';
import type { VisitStats } from '@/features/visits/services/visit.queries';
import { colors, spacing } from '@/theme';

interface StatItem {
  key: string;
  label: string;
  value: number;
  color: string;
  icon: IconName;
}

/** Tarjetas de estadísticas. "Por sincronizar" solo aparece si hay alguna. */
export function buildStatItems(stats: VisitStats): StatItem[] {
  const items: StatItem[] = [
    {
      key: 'assigned',
      label: 'Asignadas',
      value: stats.assigned,
      color: colors.visitAssigned,
      icon: 'assignment',
    },
    {
      key: 'inProgress',
      label: 'En progreso',
      value: stats.inProgress,
      color: colors.visitInProgress,
      icon: 'pending-actions',
    },
    {
      key: 'completed',
      label: 'Completadas',
      value: stats.completed,
      color: colors.visitCompleted,
      icon: 'task-alt',
    },
  ];
  if (stats.pendingSync > 0) {
    items.push({
      key: 'pendingSync',
      label: 'Por sincronizar',
      value: stats.pendingSync,
      color: colors.pendingSync,
      icon: 'cloud-upload',
    });
  }
  return items;
}

export function StatsRow({ stats }: { stats: VisitStats }) {
  return (
    <View style={styles.row}>
      {buildStatItems(stats).map((item) => (
        <Card
          key={item.key}
          style={styles.card}
          accessibilityLabel={`${item.label}: ${item.value}`}
          testID={`stat-${item.key}`}
        >
          <Icon name={item.icon} size={22} color={item.color} />
          <AppText variant="headlineMedium" color={item.color}>
            {item.value}
          </AppText>
          <AppText variant="labelMedium" numberOfLines={1}>
            {item.label}
          </AppText>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  card: {
    flexGrow: 1,
    flexBasis: 96,
    padding: spacing.sm + 4,
    gap: 2,
  },
});
