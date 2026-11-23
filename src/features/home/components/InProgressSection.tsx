import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon } from '@/components/ui';
import { isOwnVisit, visitTypeLabel, type Visit } from '@/models/visit.model';
import { colors, spacing } from '@/theme';
import { formatRelative } from '@/utils/date.utils';

export interface InProgressSectionProps {
  visits: readonly Visit[];
  onOpenVisit: (visitId: string) => void;
  onSeeAll: () => void;
  /** Usuario conectado: en las visitas de otros técnicos se muestra el técnico. */
  currentUserId?: string;
}

/** Visitas en progreso con acceso directo (el dashboard muestra como máximo 3). */
export function InProgressSection({
  visits,
  onOpenVisit,
  onSeeAll,
  currentUserId,
}: InProgressSectionProps) {
  const technicianOf = (visit: Visit) =>
    currentUserId !== undefined && !isOwnVisit(visit, currentUserId)
      ? `Técnico: ${visit.technicianName ?? 'otro técnico'}`
      : null;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <AppText variant="titleMedium" accessibilityRole="header" style={styles.title}>
          En progreso
        </AppText>
        <Button
          label="Ver todas"
          variant="text"
          onPress={onSeeAll}
          accessibilityLabel="Ver todas las visitas"
        />
      </View>

      {visits.length === 0 ? (
        <Card style={styles.empty}>
          <Icon name="check-circle-outline" size={28} color={colors.grey400} />
          <AppText variant="bodyMedium" color={colors.textSecondary} style={styles.emptyText}>
            No tienes visitas en progreso. Abre una visita asignada y pulsa “Iniciar visita”.
          </AppText>
        </Card>
      ) : (
        visits.map((visit) => (
          <Card
            key={visit.id}
            onPress={() => onOpenVisit(visit.id)}
            accessibilityLabel={`Abrir visita ${visit.title}`}
            style={styles.visit}
          >
            <Icon name="play-circle-outline" size={28} color={colors.visitInProgress} />
            <View style={styles.visitTexts}>
              <AppText variant="titleSmall" numberOfLines={2}>
                {visit.title}
              </AppText>
              <AppText variant="bodySmall" numberOfLines={1}>
                {[visit.clientName, visitTypeLabel(visit.visitType), technicianOf(visit)]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
              {visit.startedAt ? (
                <AppText variant="bodySmall" numberOfLines={1}>
                  Iniciada {formatRelative(visit.startedAt)}
                </AppText>
              ) : null}
            </View>
            <Icon name="chevron-right" size={24} color={colors.grey500} />
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: {
    flex: 1,
  },
  visit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  visitTexts: {
    flex: 1,
    gap: 2,
  },
});
