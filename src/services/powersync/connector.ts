import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SYNC } from '@/constants/app.constants';
import { scopedLogger } from '@/utils/logger';

import { uploadNextTransaction, type RemoteWriter, type RowData, type SyncIssue } from './upload';

const log = scopedLogger('sync');

/** Datos mínimos de la sesión necesarios para autenticar PowerSync. */
export interface SessionLike {
  access_token: string;
  /** Vencimiento en segundos desde época Unix. */
  expires_at?: number;
}

/** ¿El token vence dentro del margen de seguridad (5 minutos)? */
export function needsRefresh(
  session: SessionLike,
  nowMs: number = Date.now(),
  marginMs: number = SYNC.tokenRefreshMarginMs,
): boolean {
  if (!session.expires_at) return false;
  return session.expires_at * 1000 - nowMs < marginMs;
}

function isExpired(session: SessionLike, nowMs: number = Date.now()): boolean {
  return Boolean(session.expires_at) && (session.expires_at ?? 0) * 1000 <= nowMs;
}

/** Escritor remoto sobre las tablas de Supabase (PostgREST). */
export function createSupabaseWriter(supabase: SupabaseClient): RemoteWriter {
  return {
    async upsert(table: string, row: RowData) {
      const { error } = await supabase.from(table).upsert(row);
      return { error };
    },
    async update(table: string, id: string, changes: RowData) {
      const { error } = await supabase.from(table).update(changes).eq('id', id);
      return { error };
    },
    async remove(table: string, id: string) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      return { error };
    },
  };
}

async function saveIssue(database: AbstractPowerSyncDatabase, issue: SyncIssue): Promise<void> {
  await database.execute(
    `INSERT INTO sync_issues (id, table_name, row_id, operation, code, message, payload, created_at)
     VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?)`,
    [
      issue.table,
      issue.rowId,
      issue.operation,
      issue.code,
      issue.message,
      issue.payload ? JSON.stringify(issue.payload) : null,
      new Date().toISOString(),
    ],
  );
}

/**
 * Conector PowerSync ↔ Supabase.
 *
 * - `fetchCredentials`: entrega a PowerSync el JWT de Supabase, refrescándolo
 *   antes si vence en menos de 5 minutos.
 * - `uploadData`: sube a Supabase los cambios hechos sin conexión.
 */
export class SupabaseConnector implements PowerSyncBackendConnector {
  private readonly writer: RemoteWriter;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly powerSyncUrl: string,
  ) {
    this.writer = createSupabaseWriter(supabase);
  }

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) throw error;

    let session = data.session;
    // Sin sesión no hay nada que sincronizar.
    if (!session) return null;

    if (needsRefresh(session)) {
      const refreshed = await this.supabase.auth.refreshSession();
      if (refreshed.data.session) {
        session = refreshed.data.session;
      } else if (isExpired(session)) {
        // No se pudo refrescar y el token ya venció: PowerSync reintentará.
        throw refreshed.error ?? new Error('No se pudo renovar la sesión.');
      }
      // Si falló el refresco pero el token aún es válido, se usa el actual.
    }

    return {
      endpoint: this.powerSyncUrl,
      token: session.access_token,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const outcome = await uploadNextTransaction(database, this.writer, (issue) =>
      saveIssue(database, issue),
    );
    if (!outcome) return;

    for (const issue of outcome.issues) {
      // Sin datos del usuario en el log: solo tabla, operación y código.
      log.warn('El servidor rechazó un cambio', {
        table: issue.table,
        operation: issue.operation,
        code: issue.code,
      });
    }
    log.debug('Cambios subidos', { uploaded: outcome.uploaded, issues: outcome.issues.length });
  }
}
