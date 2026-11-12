import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Icon } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export interface SectionChipsProps {
  sections: readonly { id: string; title: string }[];
  activeIndex: number;
  /** Secciones con campos por corregir. */
  errorSectionIds?: readonly string[];
  onSelect: (index: number) => void;
}

/** Secciones del formulario como chips en scroll horizontal; el activo en azul primario. */
export function SectionChips({
  sections,
  activeIndex,
  errorSectionIds = [],
  onSelect,
}: SectionChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
      style={styles.scroll}
    >
      {sections.map((section, index) => {
        const selected = index === activeIndex;
        const hasError = errorSectionIds.includes(section.id);
        return (
          <Pressable
            key={section.id}
            onPress={() => onSelect(index)}
            accessibilityRole="tab"
            accessibilityLabel={
              hasError ? `${section.title}, con campos por corregir` : section.title
            }
            accessibilityState={{ selected }}
            style={[
              styles.chip,
              selected && styles.chipSelected,
              hasError && !selected && styles.chipError,
            ]}
          >
            {hasError ? (
              <Icon name="error" size={16} color={selected ? colors.onPrimary : colors.error} />
            ) : null}
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {section.title}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: spacing.minTouchTarget,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipError: {
    borderColor: colors.error,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  labelSelected: {
    fontWeight: '700',
    color: colors.onPrimary,
  },
});
