import { Canvas, Fill, Group, Path, Rect } from '@shopify/react-native-skia';
import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText, IconButton } from '@/components/ui';
import type { AnnotationElement, AnnotationTool } from '@/models/annotation.model';
import { colors, radius, spacing } from '@/theme';

import {
  DRAWING_THRESHOLDS,
  PLAN_COLORS,
  PLAN_ZOOM,
  TWO_POINT_TOOLS,
  type StrokeSize,
} from '../constants';
import type { DrawGesture } from '../hooks/useAnnotationEditor';
import { elementFromGesture } from '../services/annotation-state';
import {
  appendPoint,
  boundsFromCorners,
  contentBounds,
  distance,
  elementsInside,
  findElementAt,
  fitViewport,
  formatLength,
  gridSpacing,
  scaleBar,
  screenToWorld,
  snapSegmentEnd,
  snapToGrid,
  viewCenter,
  zoomAround,
  type Bounds,
  type Point,
  type Size,
  type Viewport,
} from '../services/geometry';
import { gridLinesPath, gridStepFor } from '../services/grid-worklet';

import { PlanShapes } from './PlanShapes';

/** Id del elemento provisional que se pinta mientras el dedo se mueve. */
const DRAFT_ID = 'trazo-en-curso';

/** Lo que el editor puede pedirle al lienzo. */
export interface PlanCanvasHandle {
  /** Centro de la pantalla en centímetros del plano. */
  center: () => Point;
  /** Escala actual (píxeles por cm). */
  scale: () => number;
}

export interface PlanCanvasProps {
  elements: readonly AnnotationElement[];
  selectedIds: readonly string[];
  tool: AnnotationTool;
  color: number;
  size: StrokeSize;
  /** Ajustar puntos a la cuadrícula y ángulos a 15°. */
  snap: boolean;
  readOnly: boolean;
  /** Gesto de dibujo terminado (no se llama con el borrador ni la selección). */
  onDraw: (gesture: DrawGesture) => void;
  /** Elementos tocados con el borrador. */
  onErase: (ids: readonly string[]) => void;
  /** Nueva selección (lista vacía = nada seleccionado). */
  onSelect: (ids: readonly string[]) => void;
  /** Elementos arrastrados con la herramienta de selección, en centímetros. */
  onMove: (ids: readonly string[], dx: number, dy: number) => void;
  ref?: Ref<PlanCanvasHandle>;
}

type Mode =
  | { kind: 'draw'; points: readonly Point[] }
  | { kind: 'erase' }
  | { kind: 'move'; ids: readonly string[]; start: Point }
  | { kind: 'marquee'; start: Point };

interface Move {
  ids: ReadonlySet<string>;
  dx: number;
  dy: number;
}

/**
 * Plano con zoom y desplazamiento: dos dedos (pellizco) acercan, alejan y
 * mueven la vista; un dedo dibuja con la herramienta elegida (o mueve la
 * vista con "Mover vista"). La vista y la cuadrícula se mueven en el hilo de
 * la interfaz; el dibujo corre en JavaScript y solo se vuelve a pintar lo que
 * cambia (el trazo en curso, lo que se arrastra).
 */
export function PlanCanvas({
  elements,
  selectedIds,
  tool,
  color,
  size,
  snap,
  readOnly,
  onDraw,
  onErase,
  onSelect,
  onMove,
  ref,
}: PlanCanvasProps) {
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  // Vista confirmada (al terminar cada gesto): escala de la barra, ajuste y puntas de flecha.
  const [view, setView] = useState<Viewport | null>(null);
  const [draft, setDraft] = useState<readonly Point[] | null>(null);
  const [erased, setErased] = useState<readonly string[]>([]);
  const [move, setMove] = useState<Move | null>(null);
  const [marquee, setMarquee] = useState<Bounds | null>(null);

  // Vista viva (hilo de la interfaz).
  const liveScale = useSharedValue<number>(PLAN_ZOOM.initial);
  const liveTx = useSharedValue(0);
  const liveTy = useSharedValue(0);
  const areaWidth = useSharedValue(0);
  const areaHeight = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);

  // Estado de los gestos de un dedo (no se lee al pintar).
  const modeRef = useRef<Mode | null>(null);
  const erasedRef = useRef<readonly string[]>([]);
  const moveRef = useRef<Move | null>(null);
  const marqueeRef = useRef<Bounds | null>(null);

  const showMove = (value: Move | null) => {
    moveRef.current = value;
    setMove(value);
  };
  const showMarquee = (value: Bounds | null) => {
    marqueeRef.current = value;
    setMarquee(value);
  };

  const currentView = (): Viewport => ({
    scale: liveScale.get(),
    tx: liveTx.get(),
    ty: liveTy.get(),
  });
  const committedScale = view?.scale ?? PLAN_ZOOM.initial;

  const applyView = (next: Viewport) => {
    liveScale.set(next.scale);
    liveTx.set(next.tx);
    liveTy.set(next.ty);
    setView(next);
  };
  const commitView = (scale: number, tx: number, ty: number) => setView({ scale, tx, ty });

  useImperativeHandle(ref, () => ({
    center: () => viewCenter(currentView(), area),
    scale: () => liveScale.get(),
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setArea({ width, height });
    areaWidth.set(width);
    areaHeight.set(height);
    // La primera vez se encuadra todo el contenido (un plano nuevo, con el origen al centro).
    if (!view && width > 0 && height > 0) {
      applyView(fitViewport(contentBounds(elements, PLAN_ZOOM.initial), { width, height }));
    }
  };

  const fit = () => applyView(fitViewport(contentBounds(elements, committedScale), area));
  const zoomBy = (factor: number) =>
    applyView(zoomAround(currentView(), { x: area.width / 2, y: area.height / 2 }, factor));

  // ── Gestos de un dedo (JavaScript) ─────────────────────────────────────────

  const toWorld = (x: number, y: number) => screenToWorld({ x, y }, currentView());
  const gridStep = () => gridSpacing(liveScale.get()).minor;
  const snapPoint = (point: Point) => (snap ? snapToGrid(point, gridStep()) : point);
  const snapEnd = (start: Point, end: Point) => {
    if (!snap) return end;
    if (tool === 'line' || tool === 'arrow' || tool === 'dimension') {
      return snapSegmentEnd(start, end, gridStep());
    }
    return snapToGrid(end, gridStep());
  };

  const eraseAt = (point: Point) => {
    const remaining = elements.filter((element) => !erasedRef.current.includes(element.id));
    const id = findElementAt(remaining, point, liveScale.get());
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

  const startGesture = (start: Point, current: Point) => {
    if (tool === 'eraser') {
      modeRef.current = { kind: 'erase' };
      eraseAt(start);
      eraseAt(current);
      return;
    }
    if (tool === 'select') {
      const hit = findElementAt(elements, start, liveScale.get());
      if (hit) {
        const ids = selectedIds.includes(hit) ? selectedIds : [hit];
        if (ids !== selectedIds) onSelect(ids);
        modeRef.current = { kind: 'move', ids, start };
      } else {
        modeRef.current = { kind: 'marquee', start };
      }
      updateGesture(current);
      return;
    }
    if (tool === 'freeStroke') {
      const minDistance = DRAWING_THRESHOLDS.minPointDistancePx / liveScale.get();
      modeRef.current = { kind: 'draw', points: appendPoint([start], current, minDistance) };
    } else if (TWO_POINT_TOOLS.has(tool)) {
      const first = snapPoint(start);
      modeRef.current = { kind: 'draw', points: [first, snapEnd(first, current)] };
    } else {
      // Texto y marcador: cuenta donde empezó el gesto.
      modeRef.current = { kind: 'draw', points: [snapPoint(start)] };
    }
    setDraft(modeRef.current.points);
  };

  const updateGesture = (current: Point) => {
    const mode = modeRef.current;
    if (!mode) return;
    switch (mode.kind) {
      case 'erase':
        eraseAt(current);
        return;
      case 'move': {
        const step = snap ? gridStep() : 0;
        const round = (value: number) => (step > 0 ? Math.round(value / step) * step : value);
        showMove({
          ids: new Set(mode.ids),
          dx: round(current.x - mode.start.x),
          dy: round(current.y - mode.start.y),
        });
        return;
      }
      case 'marquee':
        showMarquee(boundsFromCorners(mode.start, current));
        return;
      case 'draw': {
        const [first] = mode.points;
        if (!first) return;
        let points = mode.points;
        if (tool === 'freeStroke') {
          points = appendPoint(
            points,
            current,
            DRAWING_THRESHOLDS.minPointDistancePx / liveScale.get(),
          );
        } else if (TWO_POINT_TOOLS.has(tool)) {
          points = [first, snapEnd(first, current)];
        }
        modeRef.current = { kind: 'draw', points };
        setDraft(points);
      }
    }
  };

  const endGesture = (canceled: boolean) => {
    const mode = modeRef.current;
    modeRef.current = null;
    if (!mode) return;
    switch (mode.kind) {
      case 'erase':
        finishErase();
        return;
      case 'move': {
        const moved = moveRef.current;
        showMove(null);
        if (!canceled && moved && (moved.dx !== 0 || moved.dy !== 0)) {
          onMove(mode.ids, moved.dx, moved.dy);
        }
        return;
      }
      case 'marquee': {
        const box = marqueeRef.current;
        showMarquee(null);
        if (!canceled && box) onSelect(elementsInside(elements, box, liveScale.get()));
        return;
      }
      case 'draw':
        setDraft(null);
        if (!canceled && mode.points.length > 0) {
          onDraw({ points: mode.points, scale: liveScale.get() });
        }
    }
  };

  /** Un segundo dedo cancela el trazo en curso: empieza un pellizco. */
  const cancelGesture = () => {
    modeRef.current = null;
    erasedRef.current = [];
    setErased([]);
    setDraft(null);
    showMove(null);
    showMarquee(null);
  };

  const tapAt = (point: Point) => {
    if (tool === 'eraser') {
      eraseAt(point);
      finishErase();
      return;
    }
    if (tool === 'select') {
      const hit = findElementAt(elements, point, liveScale.get());
      onSelect(hit ? [hit] : []);
      return;
    }
    onDraw({ points: [snapPoint(point)], scale: liveScale.get() });
  };

  const ready = area.width > 0 && area.height > 0 && view !== null;
  const drawing = !readOnly && ready && tool !== 'pan';

  const drawPan = usePanGesture({
    runOnJS: true,
    enabled: drawing,
    testID: 'plan-canvas-draw',
    minDistance: 2,
    maxPointers: 1,
    onActivate: (event) =>
      startGesture(
        toWorld(event.x - event.translationX, event.y - event.translationY),
        toWorld(event.x, event.y),
      ),
    onUpdate: (event) => updateGesture(toWorld(event.x, event.y)),
    onDeactivate: (event) => endGesture(event.canceled),
  });

  const tap = useTapGesture({
    runOnJS: true,
    enabled: drawing,
    testID: 'plan-canvas-tap',
    maxDuration: 1000,
    onActivate: (event) => tapAt(toWorld(event.x, event.y)),
  });

  // ── Vista: pellizco y arrastre (hilo de la interfaz) ───────────────────────

  const { min: minScale, max: maxScale } = PLAN_ZOOM;

  const pinch = usePinchGesture({
    enabled: ready,
    testID: 'plan-canvas-pinch',
    onActivate: (event) => {
      'worklet';
      startScale.set(liveScale.get());
      startTx.set(liveTx.get());
      startTy.set(liveTy.get());
      startFocalX.set(event.focalX);
      startFocalY.set(event.focalY);
      scheduleOnRN(cancelGesture);
    },
    onUpdate: (event) => {
      'worklet';
      const from = startScale.get();
      const scale = Math.min(maxScale, Math.max(minScale, from * event.scale));
      // El punto del plano que estaba bajo los dedos sigue bajo los dedos.
      const worldX = (startFocalX.get() - startTx.get()) / from;
      const worldY = (startFocalY.get() - startTy.get()) / from;
      liveScale.set(scale);
      liveTx.set(event.focalX - worldX * scale);
      liveTy.set(event.focalY - worldY * scale);
    },
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(commitView, liveScale.get(), liveTx.get(), liveTy.get());
    },
  });

  const viewPan = usePanGesture({
    enabled: ready && (readOnly || tool === 'pan'),
    testID: 'plan-canvas-pan',
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      startTx.set(liveTx.get());
      startTy.set(liveTy.get());
    },
    onUpdate: (event) => {
      'worklet';
      liveTx.set(startTx.get() + event.translationX);
      liveTy.set(startTy.get() + event.translationY);
    },
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(commitView, liveScale.get(), liveTx.get(), liveTy.get());
    },
  });

  const oneFinger = useCompetingGestures(viewPan, drawPan, tap);
  const gesture = useSimultaneousGestures(pinch, oneFinger);

  // ── Pintado ────────────────────────────────────────────────────────────────

  const transform = useDerivedValue(() => [
    { translateX: liveTx.value },
    { translateY: liveTy.value },
    { scale: liveScale.value },
  ]);
  const minorGrid = useDerivedValue(() =>
    gridLinesPath(
      liveScale.value,
      liveTx.value,
      liveTy.value,
      areaWidth.value,
      areaHeight.value,
      gridStepFor(liveScale.value, 0),
    ),
  );
  const majorGrid = useDerivedValue(() =>
    gridLinesPath(
      liveScale.value,
      liveTx.value,
      liveTy.value,
      areaWidth.value,
      areaHeight.value,
      gridStepFor(liveScale.value, 1),
    ),
  );
  const outlineWidth = useDerivedValue(() => 1.5 / liveScale.value);

  // Lo tocado con el borrador desaparece al momento; lo que se arrastra se pinta aparte.
  const { still, moving } = useMemo(() => {
    const hidden = new Set(erased);
    const visible = hidden.size > 0 ? elements.filter((e) => !hidden.has(e.id)) : elements;
    if (!move) return { still: visible, moving: [] as AnnotationElement[] };
    return {
      still: visible.filter((element) => !move.ids.has(element.id)),
      moving: visible.filter((element) => move.ids.has(element.id)),
    };
  }, [elements, erased, move]);

  const draftElement = useMemo(
    () =>
      draft && tool !== 'eraser' && tool !== 'text' && tool !== 'select'
        ? elementFromGesture({
            id: DRAFT_ID,
            tool,
            points: draft,
            scale: committedScale,
            color,
            size,
          })
        : null,
    [draft, tool, committedScale, color, size],
  );

  const selectionBox = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const ids = new Set(selectedIds);
    const bounds = contentBounds(
      elements.filter((element) => ids.has(element.id)),
      committedScale,
    );
    if (!bounds) return null;
    const pad = 8 / committedScale;
    const dx = move?.dx ?? 0;
    const dy = move?.dy ?? 0;
    return {
      x: bounds.minX - pad + dx,
      y: bounds.minY - pad + dy,
      width: bounds.maxX - bounds.minX + pad * 2,
      height: bounds.maxY - bounds.minY + pad * 2,
    };
  }, [elements, selectedIds, committedScale, move]);

  const measure = measureLabel(draftElement, move);
  const bar = scaleBar(committedScale);
  const count = elements.length;
  const label = `${readOnly ? 'Plano de solo lectura' : 'Plano'}, ${count} ${
    count === 1 ? 'elemento' : 'elementos'
  }. Pellizca para acercar o alejar.`;

  return (
    <View style={styles.area} onLayout={onLayout} testID="plan-canvas-area">
      {ready ? (
        <>
          <GestureDetector gesture={gesture}>
            <View
              style={styles.fill}
              accessible
              accessibilityRole="image"
              accessibilityLabel={label}
              testID="plan-canvas"
            >
              <Canvas style={styles.fill}>
                <Fill color={PLAN_COLORS.paper} />
                <Path
                  path={minorGrid}
                  style="stroke"
                  strokeWidth={1}
                  color={PLAN_COLORS.gridMinor}
                />
                <Path
                  path={majorGrid}
                  style="stroke"
                  strokeWidth={1}
                  color={PLAN_COLORS.gridMajor}
                />
                <Group transform={transform}>
                  <PlanShapes elements={still} scale={committedScale} liveScale={liveScale} />
                  {move ? (
                    <Group transform={[{ translateX: move.dx }, { translateY: move.dy }]}>
                      <PlanShapes elements={moving} scale={committedScale} liveScale={liveScale} />
                    </Group>
                  ) : null}
                  {draftElement ? (
                    <PlanShapes
                      elements={[draftElement]}
                      scale={committedScale}
                      liveScale={liveScale}
                    />
                  ) : null}
                  {selectionBox ? (
                    <>
                      <Rect {...selectionBox} color={PLAN_COLORS.selectionFill} />
                      <Rect
                        {...selectionBox}
                        style="stroke"
                        strokeWidth={outlineWidth}
                        color={PLAN_COLORS.selection}
                      />
                    </>
                  ) : null}
                  {marquee ? (
                    <>
                      <Rect
                        x={marquee.minX}
                        y={marquee.minY}
                        width={marquee.maxX - marquee.minX}
                        height={marquee.maxY - marquee.minY}
                        color={PLAN_COLORS.selectionFill}
                      />
                      <Rect
                        x={marquee.minX}
                        y={marquee.minY}
                        width={marquee.maxX - marquee.minX}
                        height={marquee.maxY - marquee.minY}
                        style="stroke"
                        strokeWidth={outlineWidth}
                        color={PLAN_COLORS.selection}
                      />
                    </>
                  ) : null}
                </Group>
              </Canvas>
            </View>
          </GestureDetector>

          {measure ? (
            <View style={styles.measure} pointerEvents="none" testID="plan-measure">
              <AppText variant="labelLarge" color={colors.onPrimary}>
                {measure}
              </AppText>
            </View>
          ) : null}

          <View
            style={styles.scaleBar}
            pointerEvents="none"
            accessible
            accessibilityLabel={`Escala: la barra mide ${bar.label}`}
            testID="plan-scale-bar"
          >
            <View style={[styles.scaleLine, { width: bar.widthPx }]} />
            <AppText variant="labelSmall" color={colors.textPrimary}>
              {bar.label}
            </AppText>
          </View>

          <View style={styles.zoomControls}>
            <IconButton
              icon="zoom-in"
              accessibilityLabel="Acercar"
              color={colors.textPrimary}
              onPress={() => zoomBy(PLAN_ZOOM.step)}
              testID="plan-zoom-in"
            />
            <IconButton
              icon="zoom-out"
              accessibilityLabel="Alejar"
              color={colors.textPrimary}
              onPress={() => zoomBy(1 / PLAN_ZOOM.step)}
              testID="plan-zoom-out"
            />
            <IconButton
              icon="fit-screen"
              accessibilityLabel="Ver todo el plano"
              color={colors.textPrimary}
              onPress={fit}
              testID="plan-zoom-fit"
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Medida que se muestra mientras se dibuja o se arrastra. */
export function measureLabel(draft: AnnotationElement | null, move: Move | null): string | null {
  if (move) {
    return `Mover ${formatLength(Math.hypot(move.dx, move.dy))}`;
  }
  if (!draft) return null;
  const [start] = draft.points;
  const end = draft.points[draft.points.length - 1];
  if (!start || !end || draft.points.length < 2) return null;
  switch (draft.type) {
    case 'line':
    case 'arrow':
    case 'dimension':
      return formatLength(distance(start, end));
    case 'rectangle':
      return `${formatLength(Math.abs(end.x - start.x))} × ${formatLength(Math.abs(end.y - start.y))}`;
    case 'circle':
      return `Radio ${formatLength(distance(start, end))}`;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  area: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: PLAN_COLORS.paper,
  },
  fill: {
    flex: 1,
  },
  measure: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.grey900,
  },
  scaleBar: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  scaleLine: {
    height: 6,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.textPrimary,
  },
  zoomControls: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
