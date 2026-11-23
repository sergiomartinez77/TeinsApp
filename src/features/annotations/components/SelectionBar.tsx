import { StyleSheet, View } from 'react-native';

import { AppText, IconButton } from '@/components/ui';
import { colors, spacing } from '@/theme';

export interface SelectionBarProps {
  count: number;
  onDuplicate: () => void;
  onSaveFigure: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/** "1 elemento seleccionado" / "N elementos seleccionados". */
export function selectionLabel(count: number): string {
  return count === 1 ? '1 elemento seleccionado' : `${count} elementos seleccionados`;
}

/** Acciones sobre lo seleccionado: duplicar, guardar como figura, borrar y deseleccionar. */
export function SelectionBar({
  count,
  onDuplicate,
  onSaveFigure,
  onDelete,
  onClear,
}: SelectionBarProps) {
  return (
    <View style={styles.bar} testID="selection-bar">
      <AppText variant="labelLarge" color={colors.onPrimary} style={styles.label}>
        {selectionLabel(count)}
      </AppText>
      <IconButton
        icon="content-copy"
        accessibilityLabel="Duplicar"
        color={colors.onPrimary}
        onPress={onDuplicate}
        testID="selection-duplicate"
      />
      <IconButton
        icon="bookmark-add"
        accessibilityLabel="Guardar como figura"
        color={colors.onPrimary}
        onPress={onSaveFigure}
        testID="selection-save-figure"
      />
      <IconButton
        icon="delete"
        accessibilityLabel="Borrar lo seleccionado"
        color={colors.onPrimary}
        onPress={onDelete}
        testID="selection-delete"
      />
      <IconButton
        icon="close"
        accessibilityLabel="Quitar la selección"
        color={colors.onPrimary}
        onPress={onClear}
        testID="selection-clear"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    backgroundColor: colors.primary,
  },
  label: {
    flex: 1,
  },
});
