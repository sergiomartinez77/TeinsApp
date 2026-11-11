import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { colors, radius, spacing } from '@/theme';

/**
 * Indicador de sincronización para la barra superior: icono del estado y,
 * si hay cambios por enviar, un contador.
 */
export function SyncIndicator() {
  const { label, icon, pendingCount, state } = useSyncStatus();
  const showCount = pendingCount > 0 && state !== 'demo';

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="text"
      accessibilityLabel={
        showCount && state !== 'pending'
          ? `${label}. ${pendingCount} ${pendingCount === 1 ? 'cambio pendiente' : 'cambios pendientes'} de enviar`
          : label
      }
      testID="sync-indicator"
    >
      <Icon name={icon} size={24} color={colors.onPrimary} />
      {showCount ? (
        <View style={styles.counter}>
          <AppText variant="labelSmall" color={colors.textPrimary} style={styles.counterText}>
            {pendingCount > 99 ? '99+' : pendingCount}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: spacing.minTouchTarget,
    height: spacing.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    top: 4,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pendingSync,
  },
  counterText: {
    fontWeight: '700',
    letterSpacing: 0,
  },
});
