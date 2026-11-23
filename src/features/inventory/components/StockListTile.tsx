import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Card } from '@/components/ui';
import type { MaterialStockItem } from '@/models/inventory.model';
import { formatQuantityWithUnit } from '@/models/material.model';
import { colors, spacing } from '@/theme';

export const STOCK_LABELS = {
  low: 'Bajo mínimo',
  pending: 'Pendiente de sincronizar',
  noData: 'Sin datos de bodega todavía',
  noInitialCount: 'Falta conteo inicial',
  negative: 'Stock negativo: revisa el conteo',
} as const;

export interface StockListTileProps {
  item: MaterialStockItem;
  onPress: (item: MaterialStockItem) => void;
}

/**
 * Texto de las existencias: lo que dice el servidor, que aún no llegó o, si
 * nunca hubo compras ni ajustes, que falta el conteo inicial (no se muestra
 * un "−63 metro" que solo es el uso en visitas).
 */
export function onHandLabel(item: MaterialStockItem): string {
  if (!item.stock) return STOCK_LABELS.noData;
  if (item.needsInitialCount) return STOCK_LABELS.noInitialCount;
  return formatQuantityWithUnit(item.stock.onHand, item.unit);
}

/** "Usado en visitas: 63 metro" (lo calcula el servidor con todas las visitas). */
export function usedInVisitsLabel(item: MaterialStockItem): string | null {
  return item.stock
    ? `Usado en visitas: ${formatQuantityWithUnit(item.stock.used, item.unit)}`
    : null;
}

/**
 * Material con sus existencias en bodega, el mínimo y las marcas
 * "Bajo mínimo" y "Pendiente de sincronizar".
 */
export function StockListTile({ item, onPress }: StockListTileProps) {
  const onHand = onHandLabel(item);
  const minimum =
    item.minStock === null ? null : `Mínimo ${formatQuantityWithUnit(item.minStock, item.unit)}`;
  const used = item.needsInitialCount ? usedInVisitsLabel(item) : null;
  const known = item.stock !== null && !item.needsInitialCount;
  const showBadges = item.isLow || item.isNegative || item.hasPending;

  return (
    <Card
      testID={`stock-${item.materialId}`}
      onPress={() => onPress(item)}
      accessibilityLabel={[
        item.name,
        `código ${item.code}`,
        `en bodega ${onHand}`,
        minimum,
        used,
        item.isLow ? STOCK_LABELS.low : null,
        item.isNegative ? STOCK_LABELS.negative : null,
        item.hasPending ? STOCK_LABELS.pending : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="Abre el detalle del material"
    >
      <View style={styles.row}>
        <View style={styles.info}>
          <AppText variant="labelMedium">{item.code}</AppText>
          <AppText variant="titleMedium">{item.name}</AppText>
          {minimum ? <AppText variant="bodySmall">{minimum}</AppText> : null}
          {used ? <AppText variant="bodySmall">{used}</AppText> : null}
          {showBadges ? (
            <View style={styles.badges}>
              {item.isLow ? (
                <Badge label={STOCK_LABELS.low} color={colors.error} icon="warning" />
              ) : null}
              {item.isNegative ? (
                <Badge label={STOCK_LABELS.negative} color={colors.error} icon="error-outline" />
              ) : null}
              {item.hasPending ? (
                <Badge label={STOCK_LABELS.pending} color={colors.syncing} icon="sync" />
              ) : null}
            </View>
          ) : null}
        </View>
        <AppText
          variant={known ? 'titleMedium' : 'bodySmall'}
          color={
            item.needsInitialCount
              ? colors.warning
              : known
                ? item.isNegative || item.isLow
                  ? colors.error
                  : colors.primary
                : undefined
          }
          style={styles.quantity}
        >
          {onHand}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  info: {
    flex: 1,
    gap: spacing.xs,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  quantity: {
    maxWidth: '40%',
    textAlign: 'right',
  },
});
