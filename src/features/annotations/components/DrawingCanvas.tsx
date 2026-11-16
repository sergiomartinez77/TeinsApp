import { Canvas, Circle, Group, matchFont, Path, Text } from '@shopify/react-native-skia';
import { memo, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';

import type { AnnotationElement, AnnotationTool } from '@/models/annotation.model';
import { colors } from '@/theme';

import type { StrokeSize } from '../constants';
import type { DrawGesture } from '../hooks/useAnnotationEditor';
import { elementFromGesture } from '../services/annotation-state';
import {
  appendPoint,
  elementDrawing,
  findElementAt,
  fitCanvas,
  strokeScale,
  type PixelPoint,
  type Size,
} from '../services/geometry';

import { CanvasGrid } from './CanvasGrid';

/** Id del elemento provisional que se pinta mientras el dedo se mueve. */
const DRAFT_ID = 'trazo-en-curso';
const FONT_FAMILY = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });

export interface DrawingCanvasProps {
  elements: readonly AnnotationElement[];
  /** Tamaño de referencia guardado; `null` en una anotación nueva. */
  reference: Size | null;
  tool: AnnotationTool;
  color: number;
  size: StrokeSize;
  readOnly: boolean;
  /** Gesto de dibujo terminado (no se llama con el borrador). */
  onDraw: (gesture: DrawGesture) => void;
  /** Elementos tocados con el borrador. */
  onErase: (ids: readonly string[]) => void;
}

/**
 * Lienzo de dibujo con Skia. Ocupa el área disponible con la proporción de la
 * referencia (centrado, con franjas alrededor). Los gestos corren en el hilo
 * de JavaScript: los elementos terminados están memoizados y solo se vuelve
 * a pintar el trazo en curso mientras el dedo se mueve.
 */
export function DrawingCanvas({
  elements,
  reference,
  tool,
  color,
  size,
  readOnly,
  onDraw,
  onErase,
}: DrawingCanvasProps) {
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  const [draft, setDraft] = useState<readonly PixelPoint[] | null>(null);
  const [erased, setErased] = useState<readonly string[]>([]);
  // Copias para los manejadores de gestos (no se leen al pintar).
  const pointsRef = useRef<readonly PixelPoint[]>([]);
  const erasedRef = useRef<readonly string[]>([]);

  const frame = fitCanvas(area, reference);
  const { width, height } = frame;
  const scale = strokeScale(width, reference?.width ?? null);
  const ready = width > 0 && height > 0;

  // Lo tocado con el borrador desaparece al momento; se borra al levantar el dedo.
  const visible = useMemo(
    () =>
      erased.length > 0 ? elements.filter((element) => !erased.includes(element.id)) : elements,
    [elements, erased],
  );

  const draftElement = useMemo(
    () =>
      draft && tool !== 'eraser' && tool !== 'text'
        ? elementFromGesture({
            id: DRAFT_ID,
            tool,
            points: draft,
            canvasSize: { width, height },
            color,
            size,
          })
        : null,
    [draft, tool, width, height, color, size],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width: areaWidth, height: areaHeight } = event.nativeEvent.layout;
    setArea({ width: areaWidth, height: areaHeight });
  };

  const clampToCanvas = (point: PixelPoint): PixelPoint => ({
    x: Math.min(width, Math.max(0, point.x)),
    y: Math.min(height, Math.max(0, point.y)),
  });

  const eraseAt = (point: PixelPoint) => {
    const remaining = elements.filter((element) => !erasedRef.current.includes(element.id));
    const id = findElementAt(remaining, point, { width, height }, scale);
    if (!id) return;
    erasedRef.current = [...erasedRef.current, id];
    setErased(erasedRef.current);
  };

  const finishErase = () => {
    const ids = erasedRef.current;
    erasedRef.current = [];
    setErased([]);
    if (ids.length > 0) onErase(ids);
  };

  const startStroke = (point: PixelPoint, current: PixelPoint) => {
    if (tool === 'eraser') {
      eraseAt(point);
      eraseAt(current);
      return;
    }
    pointsRef.current = tool === 'freeStroke' ? appendPoint([point], current) : [point, current];
    setDraft(pointsRef.current);
  };

  const moveStroke = (current: PixelPoint) => {
    if (tool === 'eraser') {
      eraseAt(current);
      return;
    }
    const [first] = pointsRef.current;
    if (!first) return;
    pointsRef.current =
      tool === 'freeStroke' ? appendPoint(pointsRef.current, current) : [first, current];
    setDraft(pointsRef.current);
  };

  const endStroke = (canceled: boolean) => {
    if (tool === 'eraser') {
      finishErase();
      return;
    }
    const points = pointsRef.current;
    pointsRef.current = [];
    setDraft(null);
    if (!canceled && points.length > 0) onDraw({ points, canvasSize: { width, height } });
  };

  const tapAt = (point: PixelPoint) => {
    if (tool === 'eraser') {
      eraseAt(point);
      finishErase();
      return;
    }
    onDraw({ points: [point], canvasSize: { width, height } });
  };

  const enabled = !readOnly && ready;

  const pan = usePanGesture({
    runOnJS: true,
    enabled,
    testID: 'drawing-canvas-pan',
    minDistance: 2,
    maxPointers: 1,
    onActivate: (event) => {
      const current = clampToCanvas({ x: event.x, y: event.y });
      const start = clampToCanvas({
        x: event.x - event.translationX,
        y: event.y - event.translationY,
      });
      startStroke(start, current);
    },
    onUpdate: (event) => moveStroke(clampToCanvas({ x: event.x, y: event.y })),
    onDeactivate: (event) => endStroke(event.canceled),
  });

  const tap = useTapGesture({
    runOnJS: true,
    enabled,
    testID: 'drawing-canvas-tap',
    maxDuration: 1000,
    onActivate: (event) => tapAt(clampToCanvas({ x: event.x, y: event.y })),
  });

  const gesture = useCompetingGestures(pan, tap);

  const count = elements.length;
  const label = readOnly
    ? `Lienzo de anotaciones de solo lectura, ${count} ${count === 1 ? 'elemento' : 'elementos'}`
    : `Lienzo de anotaciones, ${count} ${count === 1 ? 'elemento' : 'elementos'}`;

  return (
    <View style={styles.area} onLayout={onLayout} testID="drawing-canvas-area">
      {ready ? (
        <GestureDetector gesture={gesture}>
          <View
            style={[styles.frame, { width, height, left: frame.offsetX, top: frame.offsetY }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={label}
            testID="drawing-canvas"
          >
            <Canvas style={styles.fill}>
              <CanvasLayer width={width} height={height} scale={scale} elements={visible} />
              {draftElement ? (
                <ElementShape element={draftElement} width={width} height={height} scale={scale} />
              ) : null}
            </Canvas>
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

interface LayerProps {
  elements: readonly AnnotationElement[];
  width: number;
  height: number;
  scale: number;
}

/** Elementos terminados. Solo cambia cuando cambia la lista o el tamaño del canvas. */
const CanvasLayer = memo(function CanvasLayer({ elements, width, height, scale }: LayerProps) {
  return (
    <>
      <CanvasGrid width={width} height={height} />
      {elements.map((element) => (
        <ElementShape
          key={element.id}
          element={element}
          width={width}
          height={height}
          scale={scale}
        />
      ))}
    </>
  );
});

interface ShapeProps {
  element: AnnotationElement;
  width: number;
  height: number;
  scale: number;
}

/** Un elemento: su trazado se calcula una vez por elemento y tamaño de canvas. */
const ElementShape = memo(function ElementShape({ element, width, height, scale }: ShapeProps) {
  const drawing = useMemo(
    () => elementDrawing(element, { width, height }, scale),
    [element, width, height, scale],
  );
  if (!drawing) return null;

  switch (drawing.kind) {
    case 'stroke':
      return (
        <Path
          path={drawing.path}
          style="stroke"
          strokeWidth={drawing.strokeWidth}
          strokeCap="round"
          strokeJoin="round"
          color={drawing.color}
          opacity={drawing.opacity}
        />
      );
    case 'marker':
      return (
        <Group opacity={drawing.opacity}>
          <Circle cx={drawing.cx} cy={drawing.cy} r={drawing.r} color={drawing.color} />
          <Circle
            cx={drawing.cx}
            cy={drawing.cy}
            r={drawing.r}
            style="stroke"
            strokeWidth={drawing.borderWidth}
            color={colors.surface}
          />
        </Group>
      );
    case 'text':
      return (
        <TextShape
          text={drawing.text}
          x={drawing.x}
          y={drawing.y}
          fontSize={drawing.fontSize}
          color={drawing.color}
          opacity={drawing.opacity}
        />
      );
  }
});

interface TextShapeProps {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  opacity: number;
}

/** Fuente del sistema del tamaño pedido; `null` si el dispositivo no la ofrece. */
function systemFont(fontSize: number) {
  try {
    return matchFont({ fontFamily: FONT_FAMILY, fontSize, fontWeight: '600' });
  } catch {
    return null;
  }
}

function TextShape({ text, x, y, fontSize, color, opacity }: TextShapeProps) {
  const font = useMemo(() => systemFont(fontSize), [fontSize]);
  if (!font) return null;
  return <Text text={text} x={x} y={y} font={font} color={color} opacity={opacity} />;
}

const styles = StyleSheet.create({
  area: {
    flex: 1,
    overflow: 'hidden',
  },
  frame: {
    position: 'absolute',
  },
  fill: {
    flex: 1,
  },
});
