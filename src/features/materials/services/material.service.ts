import {
  catalogMaterialFromRow,
  visitMaterialFromRow,
  type VisitMaterial,
} from '@/models/material.model';
import { isEditable, parseVisitStatus } from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

import {
  customMaterialKey,
  customNameError,
  customUnitError,
  normalizeCustomText,
  quantityValueError,
  type MaterialEntryInput,
} from '../validation';

import { INSERT_VISIT_MATERIAL_SQL, VISIT_CUSTOM_MATERIALS_SQL } from './custom-material.queries';
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

/** Los personalizados necesitan además leer varias filas (para detectar repetidos). */
export interface CustomMaterialTransaction extends MaterialTransaction {
  getAll: <T>(sql: string, parameters?: unknown[]) => Promise<T[]>;
}

export interface CustomMaterialDatabase {
  writeTransaction: <T>(callback: (tx: CustomMaterialTransaction) => Promise<T>) => Promise<T>;
}

/**
 * Código que se guarda en `material_code` de los materiales personalizados
 * (la columna es obligatoria y no hay código de catálogo). La app no lo
 * muestra: en su lugar aparece la marca "Personalizado".
 */
export const CUSTOM_MATERIAL_CODE = 'PERSONALIZADO';

export const MATERIAL_SERVICE_MESSAGES = {
  visitClosed: 'La visita está cerrada y sus materiales ya no se pueden modificar.',
  visitNotFound: 'No se encontró la visita. Es posible que ya no esté asignada a ti.',
  duplicate: 'Este material ya está en la visita. Puedes cambiar su cantidad.',
  materialUnavailable: 'Este material ya no está disponible en el catálogo.',
  itemNotFound: 'No se encontró el material en la visita. Es posible que ya se haya quitado.',
  customDuplicate:
    'Ya agregaste un material personalizado con ese nombre y esa unidad en esta visita. Puedes cambiar su cantidad.',
} as const;

/** Material que no está en el catálogo: nombre y unidad escritos por el técnico. */
export interface AddCustomMaterialInput extends MaterialEntryInput {
  visitId: string;
  name: string;
  unit: string;
}

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
async function run<T, Tx extends MaterialTransaction>(
  db: { writeTransaction: <R>(callback: (tx: Tx) => Promise<R>) => Promise<R> },
  failureMessage: string,
  callback: (tx: Tx) => Promise<T>,
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
      is_custom: 0,
    };
    await tx.execute(INSERT_VISIT_MATERIAL_SQL, insertParameters(row));
    return visitMaterialFromRow(row);
  });
}

/** Parámetros de `INSERT_VISIT_MATERIAL_SQL`, en su orden. */
function insertParameters(row: Record<string, unknown>): unknown[] {
  return [
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
    row.is_custom,
  ];
}

/**
 * Agrega a la visita un material que NO está en el catálogo (solo para esta
 * visita: el catálogo no se toca). Se guarda con `material_id = NULL`,
 * `is_custom = 1` y `material_code = 'PERSONALIZADO'`.
 *
 * Repetidos: no chocan con los del catálogo; dos personalizados con el mismo
 * nombre y unidad (sin distinguir mayúsculas ni espacios) se rechazan.
 */
export async function addCustomMaterialToVisit(
  db: CustomMaterialDatabase,
  technicianId: string,
  input: AddCustomMaterialInput,
  now: Date = new Date(),
): Promise<Result<VisitMaterial>> {
  const name = normalizeCustomText(input.name);
  const unit = normalizeCustomText(input.unit);
  const textError = customNameError(name) ?? customUnitError(unit);
  if (textError) return err(validationError(textError, 'invalid_custom_material'));
  const entry = normalizeEntry(input);
  if (!entry.ok) return entry;
  const { quantity, observations } = entry.data;
  const timestamp = now.toISOString();

  return run(db, 'No se pudo agregar el material personalizado', async (tx) => {
    await assertEditableVisit(tx, technicianId, input.visitId);

    const key = customMaterialKey(name, unit);
    const customs = await tx.getAll<Record<string, unknown>>(VISIT_CUSTOM_MATERIALS_SQL, [
      input.visitId,
    ]);
    const repeated = customs.some(
      (row) => customMaterialKey(String(row.material_name ?? ''), String(row.unit ?? '')) === key,
    );
    if (repeated) throw rule(MATERIAL_SERVICE_MESSAGES.customDuplicate, 'duplicate');

    const row: Record<string, unknown> = {
      id: generateId(),
      visit_id: input.visitId,
      material_id: null,
      material_code: CUSTOM_MATERIAL_CODE,
      material_name: name,
      unit,
      quantity,
      observations,
      sync_status: 'pendingSync',
      created_at: timestamp,
      updated_at: timestamp,
      is_custom: 1,
    };
    await tx.execute(INSERT_VISIT_MATERIAL_SQL, insertParameters(row));
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
