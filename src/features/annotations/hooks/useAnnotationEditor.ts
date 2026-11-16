import { usePowerSync } from '@powersync/react';
import { useCallback, useEffect, useReducer, useState } from 'react';

import { AUTOSAVE } from '@/constants/app.constants';
import { useAutosave } from '@/hooks/useAutosave';
import type { AnnotationElement, AnnotationTool, VisitAnnotation } from '@/models/annotation.model';
import { generateId } from '@/utils/uuid.utils';

import { ANNOTATION_DEFAULTS, strokeSizeById, type StrokeSizeId } from '../constants';
import {
  annotationReducer,
  canUndo,
  elementFromGesture,
  initialAnnotationState,
} from '../services/annotation-state';
import { saveAnnotation } from '../services/annotation.service';
import type { PixelPoint, Size } from '../services/geometry';

export interface UseAnnotationEditorOptions {
  visitId: string;
  technicianId: string;
  /** Anotación guardada; solo se usa al abrir la pantalla. */
  initial: VisitAnnotation | null;
  readOnly: boolean;
}

/** Gesto terminado sobre el canvas, en píxeles. */
export interface DrawGesture {
  points: readonly PixelPoint[];
  canvasSize: Size;
}

interface Snapshot {
  elements: readonly AnnotationElement[];
  reference: Size | null;
}

function referenceOf(annotation: VisitAnnotation | null): Size | null {
  if (!annotation?.canvasWidth || !annotation.canvasHeight) return null;
  return { width: annotation.canvasWidth, height: annotation.canvasHeight };
}

/**
 * Estado del editor de anotaciones: elementos (reductor con deshacer),
 * herramienta, color y grosor elegidos, referencia del canvas y autoguardado.
 */
export function useAnnotationEditor({
  visitId,
  technicianId,
  initial,
  readOnly,
}: UseAnnotationEditorOptions) {
  const db = usePowerSync();
  // Los elementos iniciales se fijan al abrir: los guardados posteriores no reinician el dibujo.
  const [state, dispatch] = useReducer(
    annotationReducer,
    initial?.elements ?? [],
    initialAnnotationState,
  );
  const [reference, setReference] = useState<Size | null>(() => referenceOf(initial));
  const [tool, setTool] = useState<AnnotationTool>(ANNOTATION_DEFAULTS.tool);
  const [color, setColor] = useState<number>(ANNOTATION_DEFAULTS.color);
  const [sizeId, setSizeId] = useState<StrokeSizeId>(ANNOTATION_DEFAULTS.size);
  const [pendingText, setPendingText] = useState<DrawGesture | null>(null);

  const save = useCallback(
    async ({ elements, reference: size }: Snapshot) =>
      (
        await saveAnnotation(db, technicianId, {
          visitId,
          elements,
          canvasWidth: size?.width ?? null,
          canvasHeight: size?.height ?? null,
        })
      ).ok,
    [db, technicianId, visitId],
  );
  const { status, schedule, flush } = useAutosave<Snapshot>({
    save,
    delayMs: AUTOSAVE.annotationDebounceMs,
  });

  // Cada cambio del técnico programa el autoguardado (al abrir no se guarda nada).
  const { elements, revision } = state;
  useEffect(() => {
    if (readOnly || revision === 0) return;
    schedule({ elements, reference });
  }, [readOnly, revision, elements, reference, schedule]);

  const size = strokeSizeById(sizeId);

  const addElement = (element: AnnotationElement | null, canvasSize: Size) => {
    if (!element) return;
    // La primera vez que se dibuja, el tamaño actual pasa a ser la referencia.
    if (!reference) setReference({ width: canvasSize.width, height: canvasSize.height });
    dispatch({ type: 'add', element });
  };

  const draw = (gesture: DrawGesture) => {
    if (readOnly) return;
    if (tool === 'text') {
      setPendingText(gesture);
      return;
    }
    addElement(
      elementFromGesture({ id: generateId(), tool, color, size, ...gesture }),
      gesture.canvasSize,
    );
  };

  const confirmText = (text: string) => {
    const gesture = pendingText;
    setPendingText(null);
    if (!gesture || readOnly) return;
    addElement(
      elementFromGesture({ id: generateId(), tool: 'text', color, size, text, ...gesture }),
      gesture.canvasSize,
    );
  };

  const cancelText = () => setPendingText(null);

  const erase = (ids: readonly string[]) => {
    if (readOnly || ids.length === 0) return;
    dispatch({ type: 'remove', ids });
  };

  const undo = () => {
    if (readOnly) return;
    dispatch({ type: 'undo' });
  };

  const saveNow = () => {
    if (readOnly) return;
    schedule({ elements, reference });
    void flush();
  };

  return {
    elements,
    reference,
    tool,
    setTool,
    color,
    setColor,
    sizeId,
    setSizeId,
    size,
    canUndo: canUndo(state),
    undo,
    draw,
    erase,
    isWritingText: pendingText !== null,
    confirmText,
    cancelText,
    autosaveStatus: status,
    saveNow,
  };
}
