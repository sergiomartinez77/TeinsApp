import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, type IconName } from '@/components/ui';
import { colors, radius, spacing, withAlpha } from '@/theme';

export interface QuickActionsProps {
  onMyVisits: () => void;
  /** Sin esta acción no se muestra "Nueva visita" (roles que no pueden crear). */
  onNewVisit?: () => void;
}

interface Action {
  key: string;
  label: string;
  icon: IconName;
  color: string;
  onPress: () => void;
}

/** Accesos directos del dashboard, en dos columnas. */
export function QuickActions({ onMyVisits, onNewVisit }: QuickActionsProps) {
  const actions: Action[] = [
    {
      key: 'visits',
      label: 'Mis visitas',
      icon: 'assignment',
      color: colors.primary,
      onPress: onMyVisits,
    },
  ];
  if (onNewVisit) {
    actions.push({
      key: 'new',
      label: 'Nueva visita',
      icon: 'add',
      color: colors.secondaryDark,
      onPress: onNewVisit,
    });
  }

  return (
    <View style={styles.section}>
      <AppText variant="titleMedium" accessibilityRole="header">
        Accesos directos
      </AppText>
      <View style={styles.grid}>
        {actions.map((action) => (
          <Card
            key={action.key}
            onPress={action.onPress}
            accessibilityLabel={action.label}
            style={styles.card}
          >
            <View style={[styles.iconBox, { backgroundColor: withAlpha(action.color, 0.12) }]}>
              <Icon name={action.icon} size={26} color={action.color} />
            </View>
            <AppText variant="titleSmall">{action.label}</AppText>
          </Card>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    flex: 1,
    gap: spacing.sm,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
