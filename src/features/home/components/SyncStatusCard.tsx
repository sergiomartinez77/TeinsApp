import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { colors, radius, spacing, withAlpha } from '@/theme';
import { formatRelative } from '@/utils/date.utils';

/** Tarjeta con el estado de conexión y sincronización, coloreada según el estado. */
export function SyncStatusCard() {
  const { label, description, color, icon, state, lastSyncedAt } = useSyncStatus();
  const lastSync = state !== 'demo' && lastSyncedAt ? formatRelative(lastSyncedAt) : '';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: withAlpha(color, 0.08), borderColor: withAlpha(color, 0.4) },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}. ${description}`}
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
});
