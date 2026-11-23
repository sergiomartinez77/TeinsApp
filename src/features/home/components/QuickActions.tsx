import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, type IconName } from '@/components/ui';
import { colors, radius, spacing, withAlpha } from '@/theme';

export interface QuickActionsProps {
  onMyVisits: () => void;
  /** Sin esta acción no se muestra "Nueva visita" (roles que no pueden crear). */
  onNewVisit?: () => void;
  /** Existencias de la bodega (todos los roles). Sin esta acción no se muestra. */
  onInventory?: () => void;
  /** Chat del asistente (todos los roles). Sin esta acción no se muestra. */
  onAssistant?: () => void;
}

interface Action {
  key: string;
  label: string;
  icon: IconName;
  color: string;
  onPress: () => void;
}

/** Accesos directos del dashboard: una fila de hasta tres; con cuatro, dos filas de dos. */
export function QuickActions({
  onMyVisits,
  onNewVisit,
  onInventory,
  onAssistant,
}: QuickActionsProps) {
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
  if (onInventory) {
    actions.push({
      key: 'inventory',
      label: 'Inventario',
      icon: 'inventory-2',
      color: colors.info,
      onPress: onInventory,
    });
  }

  if (onAssistant) {
    actions.push({
      key: 'assistant',
      label: 'Asistente',
      icon: 'support-agent',
      color: colors.secondary,
      onPress: onAssistant,
    });
  }
  const twoRows = actions.length > 3;

  return (
    <View style={styles.section}>
      <AppText variant="titleMedium" accessibilityRole="header">
        Accesos directos
      </AppText>
      <View style={[styles.grid, twoRows && styles.wrap]}>
        {actions.map((action) => (
          <Card
            key={action.key}
            onPress={action.onPress}
            accessibilityLabel={action.label}
            style={[styles.card, twoRows && styles.half]}
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
  wrap: {
    flexWrap: 'wrap',
  },
  card: {
    flex: 1,
    gap: spacing.sm,
  },
  half: {
    // Dos columnas: la mitad del ancho menos medio espacio entre tarjetas.
    flexBasis: '45%',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
