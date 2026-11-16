import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, withAlpha } from '@/theme';

import { VISIT_FILTERS, type VisitFilter } from '../services/visit.queries';

export interface VisitFilterTabsProps {
  value: VisitFilter;
  onChange: (filter: VisitFilter) => void;
}

/** Pestañas del listado: Todas / En progreso / Asignadas / Completadas. */
export function VisitFilterTabs({ value, onChange }: VisitFilterTabsProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.row,
        // En horizontal las pestañas no quedan bajo la muesca.
        { paddingLeft: insets.left + spacing.sm, paddingRight: insets.right + spacing.sm },
      ]}
      accessibilityRole="tablist"
    >
      {VISIT_FILTERS.map((filter) => {
        const selected = filter.key === value;
        return (
          <Pressable
            key={filter.key}
            onPress={() => onChange(filter.key)}
            accessibilityRole="tab"
            accessibilityLabel={filter.label}
            accessibilityState={{ selected }}
            style={[styles.tab, selected && styles.tabSelected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{filter.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexGrow: 1,
  },
  tab: {
    flexGrow: 1,
    minHeight: spacing.minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabSelected: {
    borderBottomColor: colors.onPrimary,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: withAlpha(colors.onPrimary, 0.75),
  },
  labelSelected: {
    fontWeight: '700',
    color: colors.onPrimary,
  },
});
