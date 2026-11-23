import {
  annotationFromRow,
  PLAN_FORMAT_VERSION,
  PLAN_NAME_MAX_LENGTH,
  serializeElements,
  type AnnotationElement,
  type VisitAnnotation,
} from '@/models/annotation.model';
import { isEditable, parseVisitStatus } from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

import {
  ANNOTATION_BY_ID_SQL,
  ANNOTATION_IN_VISIT_SQL,
  DELETE_ANNOTATION_SQL,
  INSERT_ANNOTATION_SQL,
  OWN_VISIT_SQL,
  RENAME_ANNOTATION_SQL,
  UPDATE_ANNOTATION_ELEMENTS_SQL,
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
  visitClosed: 'La visita está cerrada y sus planos ya no se pueden modificar.',
  visitNotFound: 'No se encontró la visita. Es posible que ya no esté asignada a ti.',
  planNotFound: 'No se encontró el plano. Es posible que se haya eliminado.',
} as const;

/** Señal interna para deshacer la transacción con un error ya tipado. */
class AnnotationRuleError extends Error {
  constructor(readonly result: Result<never>) {
    super('annotation-rule');
  }
}

const rule = (message: string, code: string) =>
  new AnnotationRuleError(err(validationError(message, code)));

/** Limpia un nombre: sin espacios en los extremos y con 60 caracteres como máximo. */
export function cleanName(value: string): string {
  return value.trim().slice(0, PLAN_NAME_MAX_LENGTH).trim();
}

/** Solo se escribe en visitas del técnico que siguen abiertas. */
async function assertEditableVisit(
  tx: AnnotationTransaction,
  technicianId: string,
  visitId: string,
): Promise<void> {
  const visit = await tx.getOptional<Record<string, unknown>>(OWN_VISIT_SQL, [
    visitId,
    technicianId,
  ]);
  if (!visit) throw rule(ANNOTATION_MESSAGES.visitNotFound, 'not_found');
  if (!isEditable({ status: parseVisitStatus(visit.status) })) {
    throw rule(ANNOTATION_MESSAGES.visitClosed, 'visit_closed');
  }
}

async function assertPlanInVisit(
  tx: AnnotationTransaction,
  annotationId: string,
  visitId: string,
): Promise<void> {
  const plan = await tx.getOptional(ANNOTATION_IN_VISIT_SQL, [annotationId, visitId]);
  if (!plan) throw rule(ANNOTATION_MESSAGES.planNotFound, 'not_found');
}

/** Ejecuta la transacción y convierte los errores en resultados. Nunca lanza. */
async function run<T>(
  db: AnnotationDatabase,
  action: string,
  work: (tx: AnnotationTransaction) => Promise<T>,
): Promise<Result<T>> {
  try {
    return ok(await db.writeTransaction(work));
  } catch (error) {
    if (error instanceof AnnotationRuleError) return error.result;
    log.error(`No se pudo ${action}`, error);
    return err(appError('database', { cause: error }));
  }
}

export interface CreateAnnotationInput {
  visitId: string;
  /** Nombre del plano; vacío = sin nombre ("Plano N"). */
  title: string;
}

/** Crea un plano vacío en la visita (formato 2). Queda pendiente de sincronizar. */
export function createAnnotation(
  db: AnnotationDatabase,
  technicianId: string,
  input: CreateAnnotationInput,
  now: Date = new Date(),
): Promise<Result<VisitAnnotation>> {
  const timestamp = now.toISOString();
  return run(db, 'crear el plano', async (tx) => {
    await assertEditableVisit(tx, technicianId, input.visitId);
    const row = {
      id: generateId(),
      visit_id: input.visitId,
      title: cleanName(input.title) || null,
      elements: '[]',
      base_image_path: null,
      canvas_width: null,
      canvas_height: null,
      format_version: PLAN_FORMAT_VERSION,
      sync_status: 'pendingSync',
      created_at: timestamp,
      updated_at: timestamp,
    };
    await tx.execute(INSERT_ANNOTATION_SQL, [
      row.id,
      row.visit_id,
      row.title,
      row.elements,
      row.base_image_path,
      row.canvas_width,
      row.canvas_height,
      row.format_version,
      row.sync_status,
      row.created_at,
      row.updated_at,
    ]);
    return annotationFromRow(row);
  });
}

export interface SaveAnnotationInput {
  visitId: string;
  annotationId: string;
  elements: readonly AnnotationElement[];
}

/**
 * Guarda los elementos de un plano en el formato 2. Un plano antiguo (formato
 * 1) pasa al 2 al guardarlo. Queda pendiente de sincronizar. Nunca lanza.
 */
export function saveAnnotation(
  db: AnnotationDatabase,
  technicianId: string,
  input: SaveAnnotationInput,
  now: Date = new Date(),
): Promise<Result<VisitAnnotation>> {
  const timestamp = now.toISOString();
  const elements = serializeElements(input.elements);
  return run(db, 'guardar el plano', async (tx) => {
    await assertEditableVisit(tx, technicianId, input.visitId);
    await assertPlanInVisit(tx, input.annotationId, input.visitId);
    await tx.execute(UPDATE_ANNOTATION_ELEMENTS_SQL, [
      elements,
      PLAN_FORMAT_VERSION,
      'pendingSync',
      timestamp,
      input.annotationId,
    ]);
    const row = await tx.getOptional<Record<string, unknown>>(ANNOTATION_BY_ID_SQL, [
      input.annotationId,
    ]);
    if (!row) throw rule(ANNOTATION_MESSAGES.planNotFound, 'not_found');
    return annotationFromRow(row);
  });
}

export interface PlanRef {
  visitId: string;
  annotationId: string;
}

/** Cambia el nombre de un plano (vacío = sin nombre). */
export function renameAnnotation(
  db: AnnotationDatabase,
  technicianId: string,
  input: PlanRef & { title: string },
  now: Date = new Date(),
): Promise<Result<void>> {
  return run(db, 'renombrar el plano', async (tx) => {
    await assertEditableVisit(tx, technicianId, input.visitId);
    await assertPlanInVisit(tx, input.annotationId, input.visitId);
    await tx.execute(RENAME_ANNOTATION_SQL, [
      cleanName(input.title) || null,
      'pendingSync',
      now.toISOString(),
      input.annotationId,
    ]);
  });
}

/** Elimina un plano de una visita abierta (el borrado se sincroniza). */
export function deleteAnnotation(
  db: AnnotationDatabase,
  technicianId: string,
  input: PlanRef,
): Promise<Result<void>> {
  return run(db, 'eliminar el plano', async (tx) => {
    await assertEditableVisit(tx, technicianId, input.visitId);
    await assertPlanInVisit(tx, input.annotationId, input.visitId);
    await tx.execute(DELETE_ANNOTATION_SQL, [input.annotationId]);
  });
}
