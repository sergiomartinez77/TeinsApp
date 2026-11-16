import {
  responseFromRow,
  TEMPLATE_KEY,
  type FormResponse,
  type FormTemplate,
  type FormValues,
} from '@/models/form.model';
import { isEditable, parseVisitStatus } from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';
import { generateId } from '@/utils/uuid.utils';

export { responseFromRow };

const log = scopedLogger('forms');

/** Operaciones de base de datos que usa el servicio (subconjunto de PowerSync). */
export interface FormResponseTransaction {
  execute: (sql: string, parameters?: unknown[]) => Promise<unknown>;
  getOptional: <T>(sql: string, parameters?: unknown[]) => Promise<T | null>;
}

export interface FormResponseDatabase {
  writeTransaction: <T>(callback: (tx: FormResponseTransaction) => Promise<T>) => Promise<T>;
}

/** Respuesta de una visita: hay como máximo una por visita. */
export const RESPONSE_BY_VISIT_SQL =
  'SELECT * FROM form_responses WHERE visit_id = ? ORDER BY created_at ASC LIMIT 1';

/**
 * Visita del técnico y su estado: para no escribir en visitas ajenas o cerradas
 * (igual que materiales, fotos y anotaciones).
 */
const OWN_VISIT_SQL = 'SELECT id, status FROM visits WHERE id = ? AND technician_id = ? LIMIT 1';

export const RESPONSE_MESSAGES = {
  alreadyComplete: 'El formulario ya está completado y no se puede modificar.',
  visitClosed: 'La visita está cerrada y el formulario ya no se puede modificar.',
  visitNotFound: 'No se encontró la visita. Es posible que ya no esté asignada a ti.',
} as const;

export interface SaveFormResponseInput {
  visitId: string;
  template: Pick<FormTemplate, 'id' | 'version' | 'source'>;
  values: FormValues;
}

/** Señal interna para deshacer la transacción con un error ya tipado. */
class ResponseRuleError extends Error {
  constructor(readonly result: Result<never>) {
    super('response-rule');
  }
}

/**
 * JSON a guardar. Con una plantilla de respaldo se añade la clave reservada
 * para saber después con cuál se llenó (el `template_id` queda en NULL porque
 * en el servidor es una clave foránea UUID).
 */
function serializeValues(input: SaveFormResponseInput): string {
  const payload: Record<string, unknown> = { ...input.values };
  delete payload[TEMPLATE_KEY];
  if (input.template.source === 'asset') payload[TEMPLATE_KEY] = input.template.id;
  return JSON.stringify(payload);
}

async function writeResponse(
  db: FormResponseDatabase,
  technicianId: string,
  input: SaveFormResponseInput,
  complete: boolean,
  now: Date,
): Promise<Result<FormResponse>> {
  const timestamp = now.toISOString();
  const responses = serializeValues(input);
  const templateId = input.template.source === 'database' ? input.template.id : null;

  try {
    const row = await db.writeTransaction(async (tx) => {
      // Solo se escribe en visitas del técnico que siguen abiertas (asignadas o en progreso).
      const visit = await tx.getOptional<Record<string, unknown>>(OWN_VISIT_SQL, [
        input.visitId,
        technicianId,
      ]);
      if (!visit) {
        throw new ResponseRuleError(
          err(validationError(RESPONSE_MESSAGES.visitNotFound, 'not_found')),
        );
      }
      if (!isEditable({ status: parseVisitStatus(visit.status) })) {
        throw new ResponseRuleError(
          err(validationError(RESPONSE_MESSAGES.visitClosed, 'visit_closed')),
        );
      }

      // Se comprueba dentro de la transacción: nunca hay dos filas para la misma visita.
      const existing = await tx.getOptional<Record<string, unknown>>(RESPONSE_BY_VISIT_SQL, [
        input.visitId,
      ]);

      if (!existing) {
        const id = generateId();
        const created: Record<string, unknown> = {
          id,
          visit_id: input.visitId,
          template_id: templateId,
          template_version: input.template.version,
          responses,
          sync_status: 'pendingSync',
          is_complete: complete ? 1 : 0,
          created_at: timestamp,
          updated_at: timestamp,
          completed_at: complete ? timestamp : null,
        };
        await tx.execute(
          `INSERT INTO form_responses (
             id, visit_id, template_id, template_version, responses,
             sync_status, is_complete, created_at, updated_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            input.visitId,
            templateId,
            input.template.version,
            responses,
            'pendingSync',
            created.is_complete,
            timestamp,
            timestamp,
            created.completed_at,
          ],
        );
        // Primer guardado: la visita registra con qué plantilla (y versión) se llenó.
        // Con plantilla de respaldo `form_template_id` no se toca (queda en NULL).
        if (templateId) {
          await tx.execute(
            `UPDATE visits
             SET form_template_id = ?, form_template_version = ?, sync_status = ?, updated_at = ?
             WHERE id = ?`,
            [templateId, input.template.version, 'pendingSync', timestamp, input.visitId],
          );
        } else {
          await tx.execute(
            `UPDATE visits
             SET form_template_version = ?, sync_status = ?, updated_at = ?
             WHERE id = ?`,
            [input.template.version, 'pendingSync', timestamp, input.visitId],
          );
        }
        return created;
      }

      if (Number(existing.is_complete) === 1) {
        throw new ResponseRuleError(
          err(validationError(RESPONSE_MESSAGES.alreadyComplete, 'already_complete')),
        );
      }

      const id = String(existing.id);
      if (complete) {
        await tx.execute(
          `UPDATE form_responses
           SET responses = ?, sync_status = ?, updated_at = ?, is_complete = 1, completed_at = ?
           WHERE id = ?`,
          [responses, 'pendingSync', timestamp, timestamp, id],
        );
      } else {
        await tx.execute(
          `UPDATE form_responses
           SET responses = ?, sync_status = ?, updated_at = ?
           WHERE id = ?`,
          [responses, 'pendingSync', timestamp, id],
        );
      }
      return {
        ...existing,
        responses,
        sync_status: 'pendingSync',
        updated_at: timestamp,
        ...(complete ? { is_complete: 1, completed_at: timestamp } : {}),
      };
    });
    return ok(responseFromRow(row));
  } catch (error) {
    if (error instanceof ResponseRuleError) return error.result;
    log.error('No se pudo guardar el formulario', error);
    return err(appError('database', { cause: error }));
  }
}

/**
 * Guarda las respuestas del formulario de una visita.
 * La primera vez crea la fila; después la actualiza. Siempre queda pendiente
 * de sincronizar. Nunca lanza: los errores vuelven en el `Result`.
 */
export function saveFormResponse(
  db: FormResponseDatabase,
  technicianId: string,
  input: SaveFormResponseInput,
  now: Date = new Date(),
): Promise<Result<FormResponse>> {
  return writeResponse(db, technicianId, input, false, now);
}

/** Guarda las respuestas y marca el formulario como completado. */
export function completeFormResponse(
  db: FormResponseDatabase,
  technicianId: string,
  input: SaveFormResponseInput,
  now: Date = new Date(),
): Promise<Result<FormResponse>> {
  return writeResponse(db, technicianId, input, true, now);
}
