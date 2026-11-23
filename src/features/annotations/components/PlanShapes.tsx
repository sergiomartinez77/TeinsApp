import { Circle, Group, matchFont, Path, Text } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { Platform } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { AnnotationElement } from '@/models/annotation.model';
import { colors } from '@/theme';

import { elementDrawing, type DrawingPart } from '../services/geometry';

const FONT_FAMILY = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });

/**
 * Elementos del plano dibujados con Skia dentro de un grupo que ya aplica la
 * vista (centímetros → píxeles). Los grosores son píxeles de pantalla: se
 * dividen por la escala viva (`liveScale`) para que no cambien con el zoom,
 * también durante el pellizco.
 */

export interface PlanShapesProps {
  elements: readonly AnnotationElement[];
  /** Escala confirmada (al terminar cada gesto): puntas de flecha y marcas de cota. */
  scale: number;
  /** Escala viva de la vista. */
  liveScale: SharedValue<number>;
}

export const PlanShapes = memo(function PlanShapes({
  elements,
  scale,
  liveScale,
}: PlanShapesProps) {
  return (
    <>
      {elements.map((element) => (
        <ElementShape key={element.id} element={element} scale={scale} liveScale={liveScale} />
      ))}
    </>
  );
});

interface ElementShapeProps {
  element: AnnotationElement;
  scale: number;
  liveScale: SharedValue<number>;
}

/** Un elemento: su trazado se calcula una vez por elemento y escala confirmada. */
export const ElementShape = memo(function ElementShape({
  element,
  scale,
  liveScale,
}: ElementShapeProps) {
  const drawing = useMemo(() => elementDrawing(element, scale), [element, scale]);
  if (!drawing) return null;
  return (
    <Group opacity={drawing.opacity}>
      {drawing.parts.map((part, index) => (
        <Part key={index} part={part} color={drawing.color} liveScale={liveScale} />
      ))}
    </Group>
  );
});

interface PartProps {
  part: DrawingPart;
  color: string;
  liveScale: SharedValue<number>;
}

function Part({ part, color, liveScale }: PartProps) {
  switch (part.kind) {
    case 'stroke':
      return (
        <StrokePart
          path={part.path}
          widthPx={part.strokeWidth}
          color={color}
          liveScale={liveScale}
        />
      );
    case 'marker':
      return (
        <MarkerPart
          cx={part.cx}
          cy={part.cy}
          radiusPx={part.r}
          borderPx={part.borderWidth}
          color={color}
          liveScale={liveScale}
        />
      );
    case 'text':
      return (
        <TextPart text={part.text} x={part.x} y={part.y} fontSize={part.fontSize} color={color} />
      );
  }
}

interface StrokePartProps {
  path: string;
  widthPx: number;
  color: string;
  liveScale: SharedValue<number>;
}

function StrokePart({ path, widthPx, color, liveScale }: StrokePartProps) {
  const strokeWidth = useDerivedValue(() => widthPx / liveScale.value);
  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={strokeWidth}
      strokeCap="round"
      strokeJoin="round"
      color={color}
    />
  );
}

interface MarkerPartProps {
  cx: number;
  cy: number;
  radiusPx: number;
  borderPx: number;
  color: string;
  liveScale: SharedValue<number>;
}

function MarkerPart({ cx, cy, radiusPx, borderPx, color, liveScale }: MarkerPartProps) {
  const r = useDerivedValue(() => radiusPx / liveScale.value);
  const border = useDerivedValue(() => borderPx / liveScale.value);
  return (
    <>
      <Circle cx={cx} cy={cy} r={r} color={color} />
      <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={border} color={colors.surface} />
    </>
  );
}

/** Fuente del sistema del tamaño pedido; `null` si el dispositivo no la ofrece. */
function systemFont(fontSize: number) {
  try {
    return matchFont({ fontFamily: FONT_FAMILY, fontSize, fontWeight: '600' });
  } catch {
    return null;
  }
}

interface TextPartProps {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

/** Texto en centímetros: crece y encoge con el zoom, como en un plano de papel. */
function TextPart({ text, x, y, fontSize, color }: TextPartProps) {
  const font = useMemo(() => systemFont(fontSize), [fontSize]);
  if (!font) return null;
  return <Text text={text} x={x} y={y} font={font} color={color} />;
}
