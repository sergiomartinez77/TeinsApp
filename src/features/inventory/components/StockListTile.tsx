import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Card } from '@/components/ui';
import type { MaterialStockItem } from '@/models/inventory.model';
import { formatQuantityWithUnit } from '@/models/material.model';
import { colors, spacing } from '@/theme';

export const STOCK_LABELS = {
  low: 'Bajo mínimo',
  pending: 'Pendiente de sincronizar',
  noData: 'Sin datos de bodega todavía',
} as const;

export interface StockListTileProps {
  item: MaterialStockItem;
  onPress: (item: MaterialStockItem) => void;
}

/** Texto de las existencias: lo que dice el servidor, o que aún no llegó. */
export function onHandLabel(item: MaterialStockItem): string {
  return item.stock ? formatQuantityWithUnit(item.stock.onHand, item.unit) : STOCK_LABELS.noData;
}

/**
 * Material con sus existencias en bodega, el mínimo y las marcas
 * "Bajo mínimo" y "Pendiente de sincronizar".
 */
export function StockListTile({ item, onPress }: StockListTileProps) {
  const onHand = onHandLabel(item);
  const minimum =
    item.minStock === null ? null : `Mínimo ${formatQuantityWithUnit(item.minStock, item.unit)}`;
  const negative = item.stock !== null && item.stock.onHand < 0;

  return (
    <Card
      testID={`stock-${item.materialId}`}
      onPress={() => onPress(item)}
      accessibilityLabel={[
        item.name,
        `código ${item.code}`,
        `en bodega ${onHand}`,
        minimum,
        item.isLow ? STOCK_LABELS.low : null,
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
          {item.isLow || item.hasPending ? (
            <View style={styles.badges}>
              {item.isLow ? (
                <Badge label={STOCK_LABELS.low} color={colors.error} icon="warning" />
              ) : null}
              {item.hasPending ? (
                <Badge label={STOCK_LABELS.pending} color={colors.syncing} icon="sync" />
              ) : null}
            </View>
          ) : null}
        </View>
        <AppText
          variant={item.stock ? 'titleMedium' : 'bodySmall'}
          color={item.stock ? (negative || item.isLow ? colors.error : colors.primary) : undefined}
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
