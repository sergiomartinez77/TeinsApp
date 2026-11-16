import type { PowerSyncDatabase } from '@powersync/react-native';

import { SECURE_KEYS } from '@/constants/app.constants';
import { appConfig } from '@/constants/config';
import { SupabaseConnector } from '@/services/powersync/connector';
import {
  closeDatabase,
  connectDatabase,
  getDatabaseProfile,
  openDatabase,
} from '@/services/powersync/database';
import { waitForPendingWrites } from '@/services/powersync/pending-writes';
import { getSecureItem, setSecureItem } from '@/services/storage/secure-storage';
import { getSupabase } from '@/services/supabase/client';
import { scopedLogger } from '@/utils/logger';

import { seedDemoData } from './demo-seed';

const log = scopedLogger('db');

/**
 * Cola de operaciones: abrir y cerrar la base nunca se solapan, aunque el
 * usuario cierre sesión y vuelva a entrar rápidamente.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}

async function prepareMain(userId: string): Promise<PowerSyncDatabase> {
  const db = await openDatabase('main');

  // Si el dispositivo lo usó otra persona, sus datos locales se eliminan
  // antes de continuar: cada técnico solo ve sus propios datos.
  const owner = await getSecureItem(SECURE_KEYS.databaseOwner);
  if (owner && owner !== userId) {
    log.info('La base local pertenecía a otro usuario: se limpia');
    await db.disconnectAndClear();
  }
  if (owner !== userId) await setSecureItem(SECURE_KEYS.databaseOwner, userId);

  // La sincronización arranca en segundo plano: la app no espera a la red.
  const connector = new SupabaseConnector(getSupabase(), appConfig.powerSyncUrl);
  void connectDatabase(connector).catch((error: unknown) =>
    log.warn('No se pudo iniciar la sincronización; se reintentará', error),
  );

  return db;
}

async function prepareDemo(userId: string): Promise<PowerSyncDatabase> {
  const db = await openDatabase('demo');
  // El modo demo no es persistente: cada sesión parte de datos nuevos.
  await db.disconnectAndClear();
  await seedDemoData(db, userId);
  return db;
}

/**
 * Deja lista la base local de la sesión.
 * - Sesión real: base principal, sincronizada en segundo plano.
 * - Modo demo: base aislada con datos de ejemplo, sin conexión al servidor.
 */
export function prepareSessionDatabase(
  userId: string,
  isDemo: boolean,
): Promise<PowerSyncDatabase> {
  return enqueue(() => (isDemo ? prepareDemo(userId) : prepareMain(userId)));
}

/**
 * Cierra la base al terminar la sesión.
 *
 * La base principal CONSERVA sus datos: los cambios sin subir no se pierden
 * y se envían cuando el mismo técnico vuelve a iniciar sesión.
 * La base demo se vacía.
 */
export function releaseSessionDatabase(): Promise<void> {
  return enqueue(async () => {
    // Las pantallas que se desmontan con la sesión guardan lo pendiente al
    // desmontarse; la base no se cierra hasta que esas escrituras terminen.
    await waitForPendingWrites();
    const profile = getDatabaseProfile();
    if (!profile) return;
    await closeDatabase({ clear: profile === 'demo' });
  });
}
