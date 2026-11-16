import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase, type PowerSyncBackendConnector } from '@powersync/react-native';

import { DATABASE } from '@/constants/app.constants';
import { scopedLogger } from '@/utils/logger';

import { appSchema } from './schema';

const log = scopedLogger('db');

/**
 * `main`: base del técnico, sincronizada con el servidor.
 * `demo`: base aislada del modo demo; nunca se conecta, así que sus datos
 *         ficticios jamás llegan al servidor ni se mezclan con los reales.
 */
export type DatabaseProfile = 'main' | 'demo';

interface OpenDatabase {
  profile: DatabaseProfile;
  db: PowerSyncDatabase;
}

let current: OpenDatabase | null = null;
let opening: Promise<PowerSyncDatabase> | null = null;

const FILES: Record<DatabaseProfile, string> = {
  main: DATABASE.mainFile,
  demo: DATABASE.demoFile,
};

/**
 * Abre (o reutiliza) la base de datos local. Funciona sin conexión:
 * abrir la base no requiere red ni sesión.
 */
export async function openDatabase(profile: DatabaseProfile): Promise<PowerSyncDatabase> {
  if (current?.profile === profile) return current.db;
  if (opening) await opening.catch(() => undefined);
  if (current && current.profile !== profile) await closeDatabase();

  opening = (async () => {
    const db = new PowerSyncDatabase({
      schema: appSchema,
      database: new OPSqliteOpenFactory({ dbFilename: FILES[profile] }),
    });
    await db.init();
    current = { profile, db };
    log.info('Base de datos local abierta', { profile });
    return db;
  })();

  try {
    return await opening;
  } finally {
    opening = null;
  }
}

export function getDatabaseProfile(): DatabaseProfile | null {
  return current?.profile ?? null;
}

/**
 * Conecta la base principal con PowerSync para sincronizar en segundo plano.
 * No espera a que termine la primera sincronización. La base demo nunca se conecta.
 */
export async function connectDatabase(connector: PowerSyncBackendConnector): Promise<void> {
  if (!current || current.profile !== 'main') return;
  await current.db.connect(connector);
}

/**
 * Cierra la base. Con `clear: true` además BORRA los datos locales
 * (incluidos los cambios sin subir): solo debe usarse al cerrar sesión,
 * después de avisar al usuario si tiene cambios pendientes.
 */
export async function closeDatabase(options: { clear?: boolean } = {}): Promise<void> {
  if (!current) return;
  const { db, profile } = current;
  current = null;

  if (options.clear) {
    await db.disconnectAndClear();
  } else {
    await db.disconnect();
  }
  await db.close();
  log.info('Base de datos local cerrada', { profile, cleared: Boolean(options.clear) });
}
