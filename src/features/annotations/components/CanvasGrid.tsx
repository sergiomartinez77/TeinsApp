import { Fill, Path } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';

import { colors } from '@/theme';

import { GRID_COLUMNS } from '../constants';
import { gridPath } from '../services/geometry';

export interface CanvasGridProps {
  width: number;
  height: number;
}

/** Lienzo blanco con cuadrícula gris claro (se dibuja dentro de un `Canvas` de Skia). */
export const CanvasGrid = memo(function CanvasGrid({ width, height }: CanvasGridProps) {
  const path = useMemo(() => gridPath({ width, height }, GRID_COLUMNS), [width, height]);
  return (
    <>
      <Fill color={colors.surface} />
      {path ? <Path path={path} style="stroke" strokeWidth={1} color={colors.grey300} /> : null}
    </>
  );
});
