import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import type { AnnotationTool } from '@/models/annotation.model';
import { colors, radius, spacing } from '@/theme';

import {
  ANNOTATION_PALETTE,
  ANNOTATION_TOOLS,
  STROKE_SIZES,
  type StrokeSizeId,
} from '../constants';

export interface AnnotationToolbarProps {
  tool: AnnotationTool;
  color: number;
  sizeId: StrokeSizeId;
  canUndo: boolean;
  onToolChange: (tool: AnnotationTool) => void;
  onColorChange: (color: number) => void;
  onSizeChange: (size: StrokeSizeId) => void;
  onUndo: () => void;
  /** `bottom`: filas bajo el canvas. `side`: columna al lado (horizontal / tablet). */
  layout?: 'bottom' | 'side';
}

const SWATCH_SIZE = 32;

/**
 * Barra de herramientas del dibujo sobre fondo oscuro: herramientas, colores,
 * grosores y deshacer. Cada control tiene 48dp de área táctil y anuncia si
 * está seleccionado.
 */
export function AnnotationToolbar({
  tool,
  color,
  sizeId,
  canUndo,
  onToolChange,
  onColorChange,
  onSizeChange,
  onUndo,
  layout = 'bottom',
}: AnnotationToolbarProps) {
  const side = layout === 'side';

  const tools = ANNOTATION_TOOLS.map((option) => {
    const selected = option.tool === tool;
    return (
      <ToolbarButton
        key={option.tool}
        label={option.label}
        selected={selected}
        onPress={() => onToolChange(option.tool)}
        testID={`annotation-tool-${option.tool}`}
      >
        <Icon name={option.icon} size={24} color={selected ? colors.primary : colors.onPrimary} />
      </ToolbarButton>
    );
  });

  const swatches = ANNOTATION_PALETTE.map((option) => {
    const selected = option.argb === color;
    return (
      <ToolbarButton
        key={option.hex}
        label={`Color ${option.name}`}
        selected={selected}
        onPress={() => onColorChange(option.argb)}
        testID={`annotation-color-${option.name}`}
        plain
      >
        <View
          style={[
            styles.swatch,
            { backgroundColor: option.hex },
            selected && styles.swatchSelected,
          ]}
        >
          {selected ? <Icon name="check" size={18} color={colors.onPrimary} /> : null}
        </View>
      </ToolbarButton>
    );
  });

  const sizes = STROKE_SIZES.map((option) => {
    const selected = option.id === sizeId;
    return (
      <ToolbarButton
        key={option.id}
        label={`Grosor ${option.label}`}
        selected={selected}
        onPress={() => onSizeChange(option.id)}
        testID={`annotation-size-${option.id}`}
      >
        <View
          style={[
            styles.sizeDot,
            {
              width: option.strokeWidth + 4,
              height: option.strokeWidth + 4,
              backgroundColor: selected ? colors.primary : colors.onPrimary,
            },
          ]}
        />
      </ToolbarButton>
    );
  });

  const undo = (
    <Pressable
      onPress={onUndo}
      disabled={!canUndo}
      accessibilityRole="button"
      accessibilityLabel="Deshacer"
      accessibilityState={{ disabled: !canUndo }}
      testID="annotation-undo"
      style={({ pressed }) => [styles.undo, pressed && styles.pressed, !canUndo && styles.disabled]}
    >
      <Icon name="undo" size={24} color={colors.onPrimary} />
      <AppText variant="labelLarge" color={colors.onPrimary}>
        Deshacer
      </AppText>
    </Pressable>
  );

  if (side) {
    return (
      <ScrollView
        style={styles.side}
        contentContainerStyle={styles.sideContent}
        testID="annotation-toolbar"
      >
        <View style={styles.grid}>{tools}</View>
        <Divider horizontal />
        <View style={styles.grid}>{swatches}</View>
        <Divider horizontal />
        <View style={styles.grid}>{sizes}</View>
        {undo}
      </ScrollView>
    );
  }

  return (
    <View style={styles.bottom} testID="annotation-toolbar">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {tools}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {swatches}
        <Divider />
        {sizes}
        <Divider />
        {undo}
      </ScrollView>
    </View>
  );
}

interface ToolbarButtonProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  /** Sin fondo de selección (las muestras de color marcan la selección ellas mismas). */
  plain?: boolean;
  children: ReactNode;
}

function ToolbarButton({ label, selected, onPress, testID, plain, children }: ToolbarButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        selected && !plain && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

function Divider({ horizontal = false }: { horizontal?: boolean }) {
  return <View style={horizontal ? styles.dividerHorizontal : styles.dividerVertical} />;
}

const styles = StyleSheet.create({
  bottom: {
    backgroundColor: colors.grey900,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  row: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  side: {
    flexGrow: 0,
    backgroundColor: colors.grey900,
  },
  sideContent: {
    padding: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  grid: {
    width: spacing.minTouchTarget * 2 + spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  button: {
    width: spacing.minTouchTarget,
    height: spacing.minTouchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: colors.onPrimary,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.38,
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.grey700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderColor: colors.onPrimary,
    borderWidth: 3,
  },
  sizeDot: {
    borderRadius: radius.full,
  },
  undo: {
    minHeight: spacing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  dividerVertical: {
    width: 1,
    height: spacing.lg,
    marginHorizontal: spacing.xs,
    backgroundColor: colors.grey700,
  },
  dividerHorizontal: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.grey700,
  },
});
