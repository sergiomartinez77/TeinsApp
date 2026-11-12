import {
  catalogMaterialFromRow,
  visitMaterialFromRow,
  type VisitMaterial,
} from '@/models/material.model';
import { isEditable, parseVisitStatus } from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

import { quantityValueError, type MaterialEntryInput } from '../validation';

import {
  CATALOG_MATERIAL_BY_ID_SQL,
  OWN_VISIT_SQL,
  VISIT_MATERIAL_BY_ID_SQL,
  VISIT_MATERIAL_BY_MATERIAL_SQL,
} from './material.queries';

const log = scopedLogger('materials');

/** Operaciones de base de datos que usa el servicio (subconjunto de PowerSync). */
export interface MaterialTransaction {
  execute: (sql: string, parameters?: unknown[]) => Promise<unknown>;
  getOptional: <T>(sql: string, parameters?: unknown[]) => Promise<T | null>;
}

export interface MaterialDatabase {
  writeTransaction: <T>(callback: (tx: MaterialTransaction) => Promise<T>) => Promise<T>;
}

export const MATERIAL_SERVICE_MESSAGES = {
  visitClosed: 'La visita está cerrada y sus materiales ya no se pueden modificar.',
  visitNotFound: 'No se encontró la visita. Es posible que ya no esté asignada a ti.',
  duplicate: 'Este material ya está en la visita. Puedes cambiar su cantidad.',
  materialUnavailable: 'Este material ya no está disponible en el catálogo.',
  itemNotFound: 'No se encontró el material en la visita. Es posible que ya se haya quitado.',
} as const;

/** Material nuevo: el del catálogo elegido, con su cantidad y observaciones. */
export interface AddVisitMaterialInput extends MaterialEntryInput {
  visitId: string;
  materialId: string;
}

export interface UpdateVisitMaterialInput extends MaterialEntryInput {
  visitId: string;
  visitMaterialId: string;
}

export interface RemoveVisitMaterialInput {
  visitId: string;
  visitMaterialId: string;
}

/** Señal interna para deshacer la transacción con un error ya tipado. */
class MaterialRuleError extends Error {
  constructor(readonly result: Result<never>) {
    super('material-rule');
  }
}

const rule = (message: string, code: string) =>
  new MaterialRuleError(err(validationError(message, code)));

/** Comprueba que la visita existe, es del técnico y sigue abierta. */
async function assertEditableVisit(
  tx: MaterialTransaction,
  technicianId: string,
  visitId: string,
): Promise<void> {
  const visit = await tx.getOptional<Record<string, unknown>>(OWN_VISIT_SQL, [
    visitId,
    technicianId,
  ]);
  if (!visit) throw rule(MATERIAL_SERVICE_MESSAGES.visitNotFound, 'not_found');
  if (!isEditable({ status: parseVisitStatus(visit.status) })) {
    throw rule(MATERIAL_SERVICE_MESSAGES.visitClosed, 'visit_closed');
  }
}

/** Cantidad y observaciones normalizadas, o un error de validación. */
function normalizeEntry(input: MaterialEntryInput): Result<MaterialEntryInput> {
  const quantityError = quantityValueError(input.quantity);
  if (quantityError) return err(validationError(quantityError, 'invalid_quantity'));
  const observations = input.observations?.trim() ?? '';
  return ok({ quantity: input.quantity, observations: observations || null });
}

/** Ejecuta la transacción y traduce cualquier fallo a un `Result`. */
async function run<T>(
  db: MaterialDatabase,
  failureMessage: string,
  callback: (tx: MaterialTransaction) => Promise<T>,
): Promise<Result<T>> {
  try {
    return ok(await db.writeTransaction(callback));
  } catch (error) {
    if (error instanceof MaterialRuleError) return error.result;
    log.error(failureMessage, error);
    return err(appError('database', { cause: error }));
  }
}

/**
 * Agrega un material del catálogo a la visita.
 * Copia código, nombre y unidad del catálogo y queda pendiente de sincronizar.
 * Nunca lanza: los errores vuelven en el `Result`.
 */
export async function addMaterialToVisit(
  db: MaterialDatabase,
  technicianId: string,
  input: AddVisitMaterialInput,
  now: Date = new Date(),
): Promise<Result<VisitMaterial>> {
  const entry = normalizeEntry(input);
  if (!entry.ok) return entry;
  const { quantity, observations } = entry.data;
  const timestamp = now.toISOString();

  return run(db, 'No se pudo agregar el material', async (tx) => {
    await assertEditableVisit(tx, technicianId, input.visitId);

    const catalogRow = await tx.getOptional<Record<string, unknown>>(CATALOG_MATERIAL_BY_ID_SQL, [
      input.materialId,
    ]);
    const material = catalogRow ? catalogMaterialFromRow(catalogRow) : null;
    if (!material?.isActive) {
      throw rule(MATERIAL_SERVICE_MESSAGES.materialUnavailable, 'material_unavailable');
    }

    // Se comprueba dentro de la transacción: nunca hay dos filas del mismo material.
    const existing = await tx.getOptional<Record<string, unknown>>(VISIT_MATERIAL_BY_MATERIAL_SQL, [
      input.visitId,
      input.materialId,
    ]);
    if (existing) throw rule(MATERIAL_SERVICE_MESSAGES.duplicate, 'duplicate');

    const row: Record<string, unknown> = {
      id: generateId(),
      visit_id: input.visitId,
      material_id: material.id,
      material_code: material.code,
      material_name: material.name,
      unit: material.unit,
      quantity,
      observations,
      sync_status: 'pendingSync',
      created_at: timestamp,
      updated_at: timestamp,
    };
    await tx.execute(
      `INSERT INTO visit_materials (
         id, visit_id, material_id, material_code, material_name, unit,
         quantity, observations, sync_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.visit_id,
        row.material_id,
        row.material_code,
        row.material_name,
        row.unit,
        row.quantity,
        row.observations,
        row.sync_status,
        row.created_at,
        row.updated_at,
      ],
    );
    return visitMaterialFromRow(row);
  });
}

/** Cambia la cantidad y las observaciones de un material de la visita. */
export async function updateVisitMaterial(
  db: MaterialDatabase,
  technicianId: string,
  input: UpdateVisitMaterialInput,
  now: Date = new Date(),
): Promise<Result<VisitMaterial>> {
  const entry = normalizeEntry(input);
  if (!entry.ok) return entry;
  const { quantity, observations } = entry.data;
  const timestamp = now.toISOString();

  return run(db, 'No se pudo actualizar el material', async (tx) => {
    await assertEditableVisit(tx, technicianId, input.visitId);

    const existing = await tx.getOptional<Record<string, unknown>>(VISIT_MATERIAL_BY_ID_SQL, [
      input.visitMaterialId,
      input.visitId,
    ]);
    if (!existing) throw rule(MATERIAL_SERVICE_MESSAGES.itemNotFound, 'item_not_found');

    await tx.execute(
      `UPDATE visit_materials
       SET quantity = ?, observations = ?, sync_status = ?, updated_at = ?
       WHERE id = ?`,
      [quantity, observations, 'pendingSync', timestamp, input.visitMaterialId],
    );
    return visitMaterialFromRow({
      ...existing,
      quantity,
      observations,
      sync_status: 'pendingSync',
      updated_at: timestamp,
    });
  });
}

/** Quita un material de la visita (borra la fila). */
export async function removeVisitMaterial(
  db: MaterialDatabase,
  technicianId: string,
  input: RemoveVisitMaterialInput,
): Promise<Result<void>> {
  return run(db, 'No se pudo quitar el material', async (tx) => {
    await assertEditableVisit(tx, technicianId, input.visitId);

    const existing = await tx.getOptional<Record<string, unknown>>(VISIT_MATERIAL_BY_ID_SQL, [
      input.visitMaterialId,
      input.visitId,
    ]);
    if (!existing) throw rule(MATERIAL_SERVICE_MESSAGES.itemNotFound, 'item_not_found');

    await tx.execute('DELETE FROM visit_materials WHERE id = ?', [input.visitMaterialId]);
  });
}
