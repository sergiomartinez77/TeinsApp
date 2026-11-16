import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { syncIssuesNotice } from '@/features/sync/sync-state';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { colors, radius, spacing, withAlpha } from '@/theme';
import { formatRelative } from '@/utils/date.utils';

export interface SyncStatusCardProps {
  /** Cambios que el servidor rechazó y quedaron guardados para revisión. */
  rejectedCount?: number;
}

/** Tarjeta con el estado de conexión y sincronización, coloreada según el estado. */
export function SyncStatusCard({ rejectedCount = 0 }: SyncStatusCardProps) {
  const { label, description, color, icon, state, lastSyncedAt } = useSyncStatus();
  const lastSync = state !== 'demo' && lastSyncedAt ? formatRelative(lastSyncedAt) : '';
  const rejected = syncIssuesNotice(rejectedCount);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: withAlpha(color, 0.08), borderColor: withAlpha(color, 0.4) },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={[`${label}. ${description}`, rejected].filter(Boolean).join(' ')}
      testID="sync-status-card"
    >
      <View style={[styles.iconBox, { backgroundColor: withAlpha(color, 0.16) }]}>
        <Icon name={icon} size={24} color={color} />
      </View>
      <View style={styles.texts}>
        <AppText variant="titleMedium" color={color}>
          {label}
        </AppText>
        <AppText variant="bodyMedium">{description}</AppText>
        {lastSync ? (
          <AppText variant="bodySmall" color={colors.textSecondary}>
            Última sincronización: {lastSync}
          </AppText>
        ) : null}
        {rejected ? (
          <View style={styles.rejected} testID="sync-issues-notice">
            <Icon name="report-problem" size={18} color={colors.warning} />
            <AppText variant="bodyMedium" style={styles.rejectedText}>
              {rejected}
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.cardPadding,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    gap: spacing.xs,
  },
  rejected: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  rejectedText: {
    flex: 1,
  },
});
