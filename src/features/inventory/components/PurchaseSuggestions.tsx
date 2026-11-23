import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, Icon } from '@/components/ui';
import type { MaterialStockItem, PurchaseSuggestion } from '@/models/inventory.model';
import { formatQuantityWithUnit } from '@/models/material.model';
import { colors, spacing } from '@/theme';

export interface PurchaseSuggestionsProps {
  suggestions: readonly PurchaseSuggestion[];
  /** Materiales sin conteo inicial (con mínimo o ya usados): no se calcula cuánto comprar. */
  withoutInitialCount?: readonly MaterialStockItem[];
  onOpen: (item: MaterialStockItem) => void;
}

export const PURCHASE_MESSAGES = {
  title: 'Qué comprar',
  empty: 'Nada por comprar: ningún material está por debajo de su mínimo.',
  emptyCounted: 'Ningún material con conteo inicial está por debajo de su mínimo.',
  uncountedTitle: 'Sin conteo inicial',
  uncountedHint:
    'No se puede calcular cuánto comprar: nunca se registró una compra ni un ajuste. Registra un ajuste con lo que hay en bodega.',
} as const;

/** Máximo de materiales del grupo "Sin conteo inicial" (el resto se cuenta). */
export const MAX_UNCOUNTED_SHOWN = 5;

/** Detalle de un material sin conteo inicial: lo usado (dato del servidor) y su mínimo. */
export function uncountedDetail(item: MaterialStockItem): string {
  const used = formatQuantityWithUnit(item.stock?.used ?? 0, item.unit);
  const minimum =
    item.minStock === null
      ? 'sin mínimo'
      : `mínimo ${formatQuantityWithUnit(item.minStock, item.unit)}`;
  return `Usado en visitas: ${used}; ${minimum}`;
}

/** Detalle de una sugerencia: cuánto comprar, cuánto hay y el mínimo. */
export function suggestionDetail({ item, suggestedQuantity }: PurchaseSuggestion): string {
  const onHand = item.stock ? formatQuantityWithUnit(item.stock.onHand, item.unit) : '—';
  const minimum = item.minStock === null ? '—' : formatQuantityWithUnit(item.minStock, item.unit);
  return `Comprar ${formatQuantityWithUnit(suggestedQuantity, item.unit)} (hay ${onHand}; mínimo ${minimum})`;
}

/** Sección "Qué comprar": materiales bajo mínimo con la cantidad sugerida. */
export function PurchaseSuggestions({
  suggestions,
  withoutInitialCount = [],
  onOpen,
}: PurchaseSuggestionsProps) {
  const uncounted = withoutInitialCount.slice(0, MAX_UNCOUNTED_SHOWN);
  const hiddenUncounted = withoutInitialCount.length - uncounted.length;
  return (
    <Card testID="purchase-suggestions">
      <View style={styles.header}>
        <Icon name="shopping-cart" size={22} color={colors.warning} />
        <AppText variant="titleMedium" accessibilityRole="header">
          {PURCHASE_MESSAGES.title}
        </AppText>
      </View>
      {suggestions.length === 0 ? (
        <AppText variant="bodyMedium" color={colors.textSecondary}>
          {withoutInitialCount.length === 0
            ? PURCHASE_MESSAGES.empty
            : PURCHASE_MESSAGES.emptyCounted}
        </AppText>
      ) : (
        <View style={styles.list}>
          {suggestions.map((suggestion) => {
            const detail = suggestionDetail(suggestion);
            return (
              <Pressable
                key={suggestion.item.materialId}
                onPress={() => onOpen(suggestion.item)}
                accessibilityRole="button"
                accessibilityLabel={`${suggestion.item.name}. ${detail}`}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                <AppText variant="titleSmall">{suggestion.item.name}</AppText>
                <AppText variant="bodySmall">{detail}</AppText>
              </Pressable>
            );
          })}
        </View>
      )}
      {uncounted.length > 0 ? (
        <View style={styles.group} testID="purchase-uncounted">
          <View style={styles.groupHeader}>
            <Icon name="help-outline" size={18} color={colors.warning} />
            <AppText variant="titleSmall" accessibilityRole="header">
              {`${PURCHASE_MESSAGES.uncountedTitle} (${withoutInitialCount.length})`}
            </AppText>
          </View>
          <AppText variant="bodySmall" color={colors.textSecondary}>
            {PURCHASE_MESSAGES.uncountedHint}
          </AppText>
          {uncounted.map((item) => {
            const detail = uncountedDetail(item);
            return (
              <Pressable
                key={item.materialId}
                onPress={() => onOpen(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}. ${PURCHASE_MESSAGES.uncountedTitle}. ${detail}`}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                <AppText variant="titleSmall">{item.name}</AppText>
                <AppText variant="bodySmall">{detail}</AppText>
              </Pressable>
            );
          })}
          {hiddenUncounted > 0 ? (
            <AppText variant="bodySmall">{`…y ${hiddenUncounted} más en la lista.`}</AppText>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.xs,
  },
  item: {
    minHeight: spacing.minTouchTarget,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  group: {
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
