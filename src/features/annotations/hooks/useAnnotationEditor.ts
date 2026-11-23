import { usePowerSync } from '@powersync/react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { AUTOSAVE } from '@/constants/app.constants';
import { useAutosave } from '@/hooks/useAutosave';
import type {
  AnnotationElement,
  AnnotationFigure,
  AnnotationTool,
  VisitAnnotation,
} from '@/models/annotation.model';
import { generateId } from '@/utils/uuid.utils';

import { ANNOTATION_DEFAULTS, strokeSizeById, type StrokeSizeId } from '../constants';
import {
  annotationReducer,
  canRedo,
  canUndo,
  elementFromGesture,
  initialAnnotationState,
} from '../services/annotation-state';
import { saveAnnotation } from '../services/annotation.service';
import { placeFigure } from '../services/figure.service';
import { translateElement, type Point } from '../services/geometry';

export interface UseAnnotationEditorOptions {
  visitId: string;
  technicianId: string;
  /** Plano guardado; solo se usa al abrir la pantalla. */
  initial: VisitAnnotation;
  readOnly: boolean;
}

/** Gesto terminado sobre el plano, en centímetros. */
export interface DrawGesture {
  points: readonly Point[];
  /** Escala de la vista al dibujar (píxeles por cm). */
  scale: number;
}

/**
 * Estado del editor de un plano: elementos (reductor con deshacer y
 * rehacer), selección, herramienta, color, grosor, ajuste a la cuadrícula y
 * autoguardado.
 */
export function useAnnotationEditor({
  visitId,
  technicianId,
  initial,
  readOnly,
}: UseAnnotationEditorOptions) {
  const db = usePowerSync();
  // Los elementos iniciales se fijan al abrir: los guardados posteriores no reinician el dibujo.
  const [state, dispatch] = useReducer(annotationReducer, initial.elements, initialAnnotationState);
  const [tool, setToolState] = useState<AnnotationTool>(
    readOnly ? 'pan' : ANNOTATION_DEFAULTS.tool,
  );
  const [color, setColor] = useState<number>(ANNOTATION_DEFAULTS.color);
  const [sizeId, setSizeId] = useState<StrokeSizeId>(ANNOTATION_DEFAULTS.size);
  const [snap, setSnap] = useState<boolean>(ANNOTATION_DEFAULTS.snap);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [pendingText, setPendingText] = useState<DrawGesture | null>(null);

  const annotationId = initial.id;
  const save = useCallback(
    async (elements: readonly AnnotationElement[]) =>
      (await saveAnnotation(db, technicianId, { visitId, annotationId, elements })).ok,
    [annotationId, db, technicianId, visitId],
  );
  const { status, schedule, flush } = useAutosave<readonly AnnotationElement[]>({
    save,
    delayMs: AUTOSAVE.annotationDebounceMs,
  });

  // Cada cambio del técnico programa el autoguardado (al abrir no se guarda nada).
  const { elements, revision } = state;
  useEffect(() => {
    if (readOnly || revision === 0) return;
    schedule(elements);
  }, [readOnly, revision, elements, schedule]);

  // La selección solo contiene elementos que existen (tras borrar o deshacer).
  const selectedIds = useMemo(() => {
    if (selection.length === 0) return selection;
    const existing = new Set(elements.map((element) => element.id));
    const kept = selection.filter((id) => existing.has(id));
    return kept.length === selection.length ? selection : kept;
  }, [elements, selection]);
  const selectedElements = useMemo(() => {
    const ids = new Set(selectedIds);
    return elements.filter((element) => ids.has(element.id));
  }, [elements, selectedIds]);

  const size = strokeSizeById(sizeId);

  const setTool = (next: AnnotationTool) => {
    setToolState(next);
    if (next !== 'select') setSelection([]);
  };

  const add = (added: readonly AnnotationElement[]) => {
    if (readOnly || added.length === 0) return;
    dispatch({ type: 'add', elements: added });
  };

  const draw = (gesture: DrawGesture) => {
    if (readOnly) return;
    if (tool === 'text') {
      setPendingText(gesture);
      return;
    }
    const element = elementFromGesture({ id: generateId(), tool, color, size, ...gesture });
    if (element) add([element]);
  };

  const confirmText = (text: string) => {
    const gesture = pendingText;
    setPendingText(null);
    if (!gesture || readOnly) return;
    const element = elementFromGesture({
      id: generateId(),
      tool: 'text',
      color,
      size,
      text,
      ...gesture,
    });
    if (element) add([element]);
  };

  const cancelText = () => setPendingText(null);

  const erase = (ids: readonly string[]) => {
    if (readOnly || ids.length === 0) return;
    dispatch({ type: 'remove', ids });
  };

  const select = (ids: readonly string[]) => setSelection(readOnly ? [] : ids);
  const clearSelection = () => setSelection([]);

  /** Mueve elementos `dx`, `dy` cm (los arrastrados con la herramienta de selección). */
  const moveElements = (ids: readonly string[], dx: number, dy: number) => {
    if (readOnly || ids.length === 0) return;
    dispatch({ type: 'move', ids, dx, dy });
  };

  const deleteSelection = () => {
    erase(selectedIds);
    setSelection([]);
  };

  /** Copia lo seleccionado `offset` cm abajo a la derecha y selecciona la copia. */
  const duplicateSelection = (offset: number) => {
    if (readOnly || selectedElements.length === 0) return;
    const copies = selectedElements.map((element) =>
      translateElement(element, offset, offset, generateId()),
    );
    add(copies);
    setSelection(copies.map((element) => element.id));
  };

  /** Coloca una figura de la biblioteca centrada en `center` y la deja seleccionada. */
  const insertFigure = (figure: AnnotationFigure, center: Point) => {
    if (readOnly) return;
    const placed = placeFigure(figure, center);
    if (placed.length === 0) return;
    add(placed);
    setToolState('select');
    setSelection(placed.map((element) => element.id));
  };

  const undo = () => {
    if (!readOnly) dispatch({ type: 'undo' });
  };
  const redo = () => {
    if (!readOnly) dispatch({ type: 'redo' });
  };

  const saveNow = () => {
    if (readOnly) return;
    schedule(elements);
    void flush();
  };

  return {
    elements,
    tool,
    setTool,
    color,
    setColor,
    sizeId,
    setSizeId,
    size,
    snap,
    setSnap,
    selectedIds,
    selectedElements,
    select,
    clearSelection,
    moveElements,
    deleteSelection,
    duplicateSelection,
    insertFigure,
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    undo,
    redo,
    draw,
    erase,
    isWritingText: pendingText !== null,
    confirmText,
    cancelText,
    autosaveStatus: status,
    saveNow,
  };
}

export type AnnotationEditor = ReturnType<typeof useAnnotationEditor>;
