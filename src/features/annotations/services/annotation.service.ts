import {
  annotationFromRow,
  serializeElements,
  type AnnotationElement,
  type VisitAnnotation,
} from '@/models/annotation.model';
import { isEditable, parseVisitStatus } from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

import {
  ANNOTATION_BY_VISIT_SQL,
  INSERT_ANNOTATION_SQL,
  OWN_VISIT_SQL,
  UPDATE_ANNOTATION_SQL,
} from './annotation.queries';

const log = scopedLogger('annotations');

/** Operaciones de base de datos que usa el servicio (subconjunto de PowerSync). */
export interface AnnotationTransaction {
  execute: (sql: string, parameters?: unknown[]) => Promise<unknown>;
  getOptional: <T>(sql: string, parameters?: unknown[]) => Promise<T | null>;
}

export interface AnnotationDatabase {
  writeTransaction: <T>(callback: (tx: AnnotationTransaction) => Promise<T>) => Promise<T>;
}

export const ANNOTATION_MESSAGES = {
  visitClosed: 'La visita está cerrada y sus anotaciones ya no se pueden modificar.',
  visitNotFound: 'No se encontró la visita. Es posible que ya no esté asignada a ti.',
} as const;

export interface SaveAnnotationInput {
  visitId: string;
  elements: readonly AnnotationElement[];
  /** Tamaño de referencia del canvas; `null` si todavía no se ha dibujado. */
  canvasWidth: number | null;
  canvasHeight: number | null;
}

/** Señal interna para deshacer la transacción con un error ya tipado. */
class AnnotationRuleError extends Error {
  constructor(readonly result: Result<never>) {
    super('annotation-rule');
  }
}

const rule = (message: string, code: string) =>
  new AnnotationRuleError(err(validationError(message, code)));

const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/**
 * Guarda los elementos de la anotación de la visita: la primera vez crea la
 * fila (con la referencia del canvas) y después la actualiza. Nunca hay dos
 * filas por visita. Queda pendiente de sincronizar. Nunca lanza.
 */
export async function saveAnnotation(
  db: AnnotationDatabase,
  technicianId: string,
  input: SaveAnnotationInput,
  now: Date = new Date(),
): Promise<Result<VisitAnnotation>> {
  const timestamp = now.toISOString();
  const elements = serializeElements(input.elements);

  try {
    const row = await db.writeTransaction(async (tx) => {
      // Solo se escribe en visitas del técnico que siguen abiertas.
      const visit = await tx.getOptional<Record<string, unknown>>(OWN_VISIT_SQL, [
        input.visitId,
        technicianId,
      ]);
      if (!visit) throw rule(ANNOTATION_MESSAGES.visitNotFound, 'not_found');
      if (!isEditable({ status: parseVisitStatus(visit.status) })) {
        throw rule(ANNOTATION_MESSAGES.visitClosed, 'visit_closed');
      }

      // Se comprueba dentro de la transacción: nunca hay dos filas para la misma visita.
      const existing = await tx.getOptional<Record<string, unknown>>(ANNOTATION_BY_VISIT_SQL, [
        input.visitId,
      ]);

      if (!existing) {
        const id = generateId();
        const created: Record<string, unknown> = {
          id,
          visit_id: input.visitId,
          title: null,
          elements,
          base_image_path: null,
          canvas_width: positive(input.canvasWidth),
          canvas_height: positive(input.canvasHeight),
          sync_status: 'pendingSync',
          created_at: timestamp,
          updated_at: timestamp,
        };
        await tx.execute(INSERT_ANNOTATION_SQL, [
          id,
          input.visitId,
          null,
          elements,
          null,
          created.canvas_width,
          created.canvas_height,
          'pendingSync',
          timestamp,
          timestamp,
        ]);
        return created;
      }

      // La referencia guardada no cambia: de ella dependen la proporción y los grosores.
      const storedWidth = positive(existing.canvas_width);
      const storedHeight = positive(existing.canvas_height);
      const keepStored = storedWidth !== null && storedHeight !== null;
      const canvasWidth = keepStored ? storedWidth : positive(input.canvasWidth);
      const canvasHeight = keepStored ? storedHeight : positive(input.canvasHeight);
      const id = String(existing.id);
      await tx.execute(UPDATE_ANNOTATION_SQL, [
        elements,
        canvasWidth,
        canvasHeight,
        'pendingSync',
        timestamp,
        id,
      ]);
      return {
        ...existing,
        elements,
        canvas_width: canvasWidth,
        canvas_height: canvasHeight,
        sync_status: 'pendingSync',
        updated_at: timestamp,
      };
    });
    return ok(annotationFromRow(row));
  } catch (error) {
    if (error instanceof AnnotationRuleError) return error.result;
    log.error('No se pudo guardar la anotación', error);
    return err(appError('database', { cause: error }));
  }
}
