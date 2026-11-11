import { canCreateVisit, type UserProfile } from '@/models/user.model';
import {
  transitionVisit,
  visitFromRow,
  type Visit,
  type VisitStatus,
} from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

import type { CreateVisitInput } from '../validation';

import { VISIT_BY_ID_SQL } from './visit.queries';

const log = scopedLogger('visits');

/** Operaciones de base de datos que usa el servicio (subconjunto de PowerSync). */
export interface VisitTransaction {
  execute: (sql: string, parameters?: unknown[]) => Promise<unknown>;
  getOptional: <T>(sql: string, parameters?: unknown[]) => Promise<T | null>;
}

export interface VisitDatabase {
  writeTransaction: <T>(callback: (tx: VisitTransaction) => Promise<T>) => Promise<T>;
}

export const VISIT_MESSAGES = {
  notFound: 'No se encontró la visita. Es posible que ya no esté asignada a ti.',
  cannotCreate: 'Tu usuario no tiene permiso para crear visitas.',
} as const;

/**
 * Crea una visita nueva asignada al propio técnico.
 *
 * El identificador se genera en el dispositivo y la visita se guarda primero
 * en SQLite: funciona sin conexión y PowerSync la sube después.
 */
export async function createVisit(
  db: VisitDatabase,
  user: Pick<UserProfile, 'id' | 'role'>,
  input: CreateVisitInput,
  now: Date = new Date(),
): Promise<Result<Visit>> {
  if (!canCreateVisit(user.role)) {
    return err(appError('unauthorized', { message: VISIT_MESSAGES.cannotCreate }));
  }

  const id = generateId();
  const timestamp = now.toISOString();

  try {
    await db.writeTransaction((tx) =>
      tx.execute(
        `INSERT INTO visits (
           id, technician_id, title, description, visit_type, address,
           status, sync_status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'assigned', 'pendingSync', ?, ?)`,
        [
          id,
          user.id,
          input.title,
          input.description,
          input.visitType,
          input.address,
          timestamp,
          timestamp,
        ],
      ),
    );
  } catch (error) {
    log.error('No se pudo crear la visita', error);
    return err(appError('database', { cause: error }));
  }

  return ok(
    visitFromRow({
      id,
      technician_id: user.id,
      title: input.title,
      description: input.description,
      visit_type: input.visitType,
      address: input.address,
      status: 'assigned',
      sync_status: 'pendingSync',
      created_at: timestamp,
      updated_at: timestamp,
    }),
  );
}

/** Señal interna para deshacer la transacción con un error ya tipado. */
class VisitRuleError extends Error {
  constructor(readonly result: Result<never>) {
    super('visit-rule');
  }
}

/**
 * Cambia el estado de una visita aplicando la máquina de estados.
 * Leer y escribir ocurren en la misma transacción: nunca se aplica una
 * transición sobre un estado que ya cambió.
 */
async function changeStatus(
  db: VisitDatabase,
  technicianId: string,
  visitId: string,
  next: VisitStatus,
  now: Date,
): Promise<Result<Visit>> {
  try {
    const visit = await db.writeTransaction(async (tx) => {
      const row = await tx.getOptional<Record<string, unknown>>(VISIT_BY_ID_SQL, [
        visitId,
        technicianId,
      ]);
      if (!row) throw new VisitRuleError(err(validationError(VISIT_MESSAGES.notFound, 'not_found')));

      const current = visitFromRow(row);
      const transition = transitionVisit(current, next, now);
      if (!transition.ok) throw new VisitRuleError(err(transition.error));

      const changes = transition.data;
      await tx.execute(
        `UPDATE visits
         SET status = ?, started_at = ?, completed_at = ?, updated_at = ?, sync_status = ?
         WHERE id = ?`,
        [
          changes.status,
          changes.startedAt,
          changes.completedAt,
          changes.updatedAt,
          changes.syncStatus,
          visitId,
        ],
      );

      return { ...current, ...changes };
    });
    return ok(visit);
  } catch (error) {
    if (error instanceof VisitRuleError) return error.result;
    log.error('No se pudo cambiar el estado de la visita', error);
    return err(appError('database', { cause: error }));
  }
}

/** Inicia la visita (asignada → en progreso) y registra la hora de inicio. */
export function startVisit(
  db: VisitDatabase,
  technicianId: string,
  visitId: string,
  now: Date = new Date(),
): Promise<Result<Visit>> {
  return changeStatus(db, technicianId, visitId, 'inProgress', now);
}

/** Finaliza la visita (en progreso → completada) y registra la hora de finalización. */
export function completeVisit(
  db: VisitDatabase,
  technicianId: string,
  visitId: string,
  now: Date = new Date(),
): Promise<Result<Visit>> {
  return changeStatus(db, technicianId, visitId, 'completed', now);
}
