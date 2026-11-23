import { Canvas, Fill, Group } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import type { AnnotationElement } from '@/models/annotation.model';
import { colors, radius } from '@/theme';

import { PLAN_COLORS } from '../constants';
import { contentBounds, fitViewport } from '../services/geometry';

import { PlanShapes } from './PlanShapes';

export interface PlanPreviewProps {
  elements: readonly AnnotationElement[];
  width: number;
  height: number;
  testID?: string;
}

/** Miniatura fija de un plano o una figura: encuadra todo el contenido. */
export function PlanPreview({ elements, width, height, testID }: PlanPreviewProps) {
  const view = useMemo(
    () => fitViewport(contentBounds(elements, 1), { width, height }),
    [elements, width, height],
  );
  const liveScale = useSharedValue(view.scale);
  useEffect(() => {
    liveScale.set(view.scale);
  }, [liveScale, view.scale]);

  return (
    <View
      style={[styles.frame, { width, height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Canvas style={styles.fill}>
        <Fill color={PLAN_COLORS.paper} />
        <Group
          transform={[{ translateX: view.tx }, { translateY: view.ty }, { scale: view.scale }]}
        >
          <PlanShapes elements={elements} scale={view.scale} liveScale={liveScale} />
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fill: {
    flex: 1,
  },
});
