import {
  figureFromRow,
  serializeElements,
  type AnnotationElement,
  type AnnotationFigure,
} from '@/models/annotation.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

import { DELETE_FIGURE_SQL, INSERT_FIGURE_SQL } from './annotation.queries';
import { cleanName, type AnnotationDatabase } from './annotation.service';
import { contentBounds, translateElement, type Point } from './geometry';

const log = scopedLogger('annotations');

export const FIGURE_MESSAGES = {
  empty: 'Selecciona al menos un elemento para guardar la figura.',
  noName: 'Escribe un nombre para la figura.',
} as const;

/**
 * Escala con la que se miden los límites al guardar una figura. Solo afecta
 * a los marcadores (miden lo mismo en pantalla con cualquier zoom).
 */
const FIGURE_REFERENCE_SCALE = 1;

/** Elementos de la figura con su esquina superior izquierda en (0, 0), y su tamaño. */
export function normalizeFigure(elements: readonly AnnotationElement[]): {
  elements: AnnotationElement[];
  width: number;
  height: number;
} {
  const bounds = contentBounds(elements, FIGURE_REFERENCE_SCALE);
  if (!bounds) return { elements: [], width: 0, height: 0 };
  return {
    elements: elements.map((element) => translateElement(element, -bounds.minX, -bounds.minY)),
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

/**
 * Elementos nuevos (con ids nuevos) para colocar la figura con su centro en
 * `center` (centímetros del plano).
 */
export function placeFigure(
  figure: Pick<AnnotationFigure, 'elements' | 'width' | 'height'>,
  center: Point,
  newId: () => string = generateId,
): AnnotationElement[] {
  const dx = center.x - figure.width / 2;
  const dy = center.y - figure.height / 2;
  return figure.elements.map((element) => translateElement(element, dx, dy, newId()));
}

export interface SaveFigureInput {
  name: string;
  elements: readonly AnnotationElement[];
}

/** Guarda una figura en la biblioteca del técnico (sirve en todas sus visitas). */
export async function saveFigure(
  db: AnnotationDatabase,
  technicianId: string,
  input: SaveFigureInput,
  now: Date = new Date(),
): Promise<Result<AnnotationFigure>> {
  const name = cleanName(input.name);
  if (!name) return err(validationError(FIGURE_MESSAGES.noName, 'required'));
  const figure = normalizeFigure(input.elements);
  if (figure.elements.length === 0) return err(validationError(FIGURE_MESSAGES.empty, 'empty'));

  const timestamp = now.toISOString();
  const row = {
    id: generateId(),
    technician_id: technicianId,
    name,
    elements: serializeElements(figure.elements),
    width: figure.width,
    height: figure.height,
    sync_status: 'pendingSync',
    created_at: timestamp,
    updated_at: timestamp,
  };
  try {
    await db.writeTransaction((tx) =>
      tx.execute(INSERT_FIGURE_SQL, [
        row.id,
        row.technician_id,
        row.name,
        row.elements,
        row.width,
        row.height,
        row.sync_status,
        row.created_at,
        row.updated_at,
      ]),
    );
    return ok(figureFromRow(row));
  } catch (error) {
    log.error('No se pudo guardar la figura', error);
    return err(appError('database', { cause: error }));
  }
}

/** Elimina una figura de la biblioteca del técnico. Los planos que ya la usan no cambian. */
export async function deleteFigure(
  db: AnnotationDatabase,
  technicianId: string,
  figureId: string,
): Promise<Result<void>> {
  try {
    await db.writeTransaction((tx) => tx.execute(DELETE_FIGURE_SQL, [figureId, technicianId]));
    return ok(undefined);
  } catch (error) {
    log.error('No se pudo eliminar la figura', error);
    return err(appError('database', { cause: error }));
  }
}
