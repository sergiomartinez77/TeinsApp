import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, Icon } from '@/components/ui';
import type { MaterialStockItem, PurchaseSuggestion } from '@/models/inventory.model';
import { formatQuantityWithUnit } from '@/models/material.model';
import { colors, spacing } from '@/theme';

export interface PurchaseSuggestionsProps {
  suggestions: readonly PurchaseSuggestion[];
  onOpen: (item: MaterialStockItem) => void;
}

export const PURCHASE_MESSAGES = {
  title: 'Qué comprar',
  empty: 'Nada por comprar: ningún material está por debajo de su mínimo.',
} as const;

/** Detalle de una sugerencia: cuánto comprar, cuánto hay y el mínimo. */
export function suggestionDetail({ item, suggestedQuantity }: PurchaseSuggestion): string {
  const onHand = item.stock ? formatQuantityWithUnit(item.stock.onHand, item.unit) : '—';
  const minimum = item.minStock === null ? '—' : formatQuantityWithUnit(item.minStock, item.unit);
  return `Comprar ${formatQuantityWithUnit(suggestedQuantity, item.unit)} (hay ${onHand}; mínimo ${minimum})`;
}

/** Sección "Qué comprar": materiales bajo mínimo con la cantidad sugerida. */
export function PurchaseSuggestions({ suggestions, onOpen }: PurchaseSuggestionsProps) {
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
          {PURCHASE_MESSAGES.empty}
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
});
