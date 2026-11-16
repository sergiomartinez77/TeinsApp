import { photoStoragePath } from '@/constants/app.constants';
import { isOnline, subscribeConnectivity } from '@/services/connectivity/connectivity.service';
import { scopedLogger } from '@/utils/logger';

import { devicePhotoFiles, type PhotoFileSystem } from './photo-files';
import { supabasePhotoStorage, type RemotePhotoStorage } from './photo-storage';
import {
  MARK_PHOTO_STATUS_SQL,
  MARK_PHOTO_UPLOADED_SQL,
  PENDING_UPLOAD_COUNT_SQL,
  PENDING_UPLOADS_SQL,
  RESET_INTERRUPTED_UPLOADS_SQL,
} from './photo.queries';

const log = scopedLogger('photos');

/** Reintento periódico mientras queden fotos pendientes y haya conexión. */
export const UPLOAD_RETRY_MS = 60 * 1000;

/** Operaciones de base de datos que usa el gestor (subconjunto de PowerSync). */
export interface UploaderDatabase {
  getAll: <T>(sql: string, parameters?: unknown[]) => Promise<T[]>;
  execute: (sql: string, parameters?: unknown[]) => Promise<unknown>;
}

export interface UploaderConnectivity {
  isOnline: () => boolean;
  /** Avisa al cambiar la conexión. Devuelve la función para cancelar. */
  subscribe: (listener: () => void) => () => void;
}

export interface UploaderTimer {
  setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface PhotoUploaderDeps {
  db: UploaderDatabase;
  technicianId: string;
  storage: RemotePhotoStorage;
  files: Pick<PhotoFileSystem, 'exists' | 'read'>;
  connectivity: UploaderConnectivity;
  timer?: UploaderTimer;
  now?: () => Date;
  retryMs?: number;
}

export interface PhotoUploader {
  /**
   * Pide una pasada de subida. Si ya hay una en curso no se abre otra: la
   * pasada actual vuelve a consultar la cola antes de terminar.
   * La promesa se resuelve cuando termina la pasada.
   */
  trigger: () => Promise<void>;
  /** Cancela el temporizador y la suscripción a la conectividad. */
  stop: () => void;
}

interface PendingRow {
  id: unknown;
  visit_id: unknown;
  local_path: unknown;
}

const defaultTimer: UploaderTimer = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * Gestor de subidas de fotografías a Supabase Storage.
 *
 * Sube de una en una las fotos del técnico pendientes (`local`,
 * `pendingUpload`, `uploadError`). Por foto: `uploading` → subida →
 * `uploaded` con `storage_path`, `storage_url` y `uploaded_at`; si falla,
 * `uploadError`. Sin conexión no intenta nada: es un estado normal.
 *
 * Disparadores: al arrancar, al recuperar la conexión, tras capturar una foto
 * (`trigger`) y un reintento cada 60 s mientras queden pendientes.
 */
export function createPhotoUploader(deps: PhotoUploaderDeps): PhotoUploader {
  const { db, technicianId, storage, files, connectivity } = deps;
  const timer = deps.timer ?? defaultTimer;
  const now = deps.now ?? (() => new Date());
  const retryMs = deps.retryMs ?? UPLOAD_RETRY_MS;

  let stopped = false;
  let running: Promise<void> | null = null;
  /** Se pidió otra pasada mientras había una en curso. */
  let rerun = false;
  let retryHandle: ReturnType<typeof setTimeout> | null = null;
  let wasOnline = connectivity.isOnline();

  // Las fotos que quedaron "subiendo" (app cerrada a mitad) vuelven a la cola.
  const ready = db
    .execute(RESET_INTERRUPTED_UPLOADS_SQL, [technicianId])
    .then(() => undefined)
    .catch((error: unknown) => log.warn('No se pudieron recuperar subidas interrumpidas', error));

  const clearRetry = () => {
    if (retryHandle !== null) timer.clearTimeout(retryHandle);
    retryHandle = null;
  };

  const armRetry = () => {
    clearRetry();
    if (stopped) return;
    retryHandle = timer.setTimeout(() => {
      retryHandle = null;
      void trigger();
    }, retryMs);
  };

  const mark = (photoId: string, status: string) =>
    db.execute(MARK_PHOTO_STATUS_SQL, [status, photoId]);

  /** Sube una foto. Devuelve `false` si se perdió la conexión durante la subida. */
  const uploadOne = async (row: PendingRow): Promise<boolean> => {
    const photoId = String(row.id);
    const localPath = typeof row.local_path === 'string' ? row.local_path : '';
    const storagePath = photoStoragePath(String(row.visit_id), photoId);

    if (!files.exists(localPath)) {
      log.warn('Una fotografía no tiene archivo en el dispositivo y no se puede subir');
      await mark(photoId, 'uploadError');
      return true;
    }

    await mark(photoId, 'uploading');
    try {
      const content = await files.read(localPath);
      await storage.upload(storagePath, content);
    } catch (error) {
      if (!connectivity.isOnline()) {
        // Se cortó la red: no es un error, la foto vuelve a la cola.
        await mark(photoId, 'pendingUpload');
        return false;
      }
      log.warn('No se pudo subir una fotografía', error);
      await mark(photoId, 'uploadError');
      return true;
    }

    await db.execute(MARK_PHOTO_UPLOADED_SQL, [
      storagePath,
      storage.objectUrl(storagePath),
      now().toISOString(),
      photoId,
    ]);
    return true;
  };

  /**
   * Procesa la cola hasta vaciarla. Una foto que falla no se reintenta dentro
   * de la misma pasada; las capturadas mientras tanto sí se incluyen.
   */
  const drain = async (attempted: Set<string>) => {
    while (!stopped && connectivity.isOnline()) {
      const rows = await db.getAll<PendingRow>(PENDING_UPLOADS_SQL, [technicianId]);
      const next = rows.filter((row) => !attempted.has(String(row.id)));
      if (next.length === 0) return;
      for (const row of next) {
        if (stopped || !connectivity.isOnline()) return;
        attempted.add(String(row.id));
        if (!(await uploadOne(row))) return;
      }
    }
  };

  const scheduleRetry = async () => {
    if (stopped || !connectivity.isOnline()) return;
    const [result] = await db.getAll<{ count: unknown }>(PENDING_UPLOAD_COUNT_SQL, [technicianId]);
    if (Number(result?.count ?? 0) > 0) armRetry();
  };

  const pass = async () => {
    clearRetry();
    try {
      await ready;
      const attempted = new Set<string>();
      do {
        rerun = false;
        await drain(attempted);
      } while (rerun && !stopped);
      await scheduleRetry();
    } catch (error) {
      log.warn('Falló una pasada de subida de fotografías', error);
      if (!stopped && connectivity.isOnline()) armRetry();
    } finally {
      running = null;
    }
  };

  function trigger(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    if (!connectivity.isOnline()) return Promise.resolve();
    running = pass();
    return running;
  }

  const unsubscribe = connectivity.subscribe(() => {
    const online = connectivity.isOnline();
    if (online && !wasOnline) void trigger();
    if (!online) clearRetry();
    wasOnline = online;
  });

  void trigger();

  return {
    trigger,
    stop: () => {
      stopped = true;
      clearRetry();
      unsubscribe();
    },
  };
}

// ── Gestor de la sesión ──────────────────────────────────────────────────────

let active: PhotoUploader | null = null;

/**
 * Arranca el gestor de la sesión real (nunca en modo demo).
 * Devuelve la función para detenerlo.
 */
export function startPhotoUploader(db: UploaderDatabase, technicianId: string): () => void {
  active?.stop();
  const uploader = createPhotoUploader({
    db,
    technicianId,
    storage: supabasePhotoStorage,
    files: devicePhotoFiles,
    connectivity: { isOnline, subscribe: subscribeConnectivity },
  });
  active = uploader;
  return () => {
    uploader.stop();
    if (active === uploader) active = null;
  };
}

/** Pide una pasada de subida (p. ej. justo después de capturar). Sin gestor no hace nada. */
export function requestPhotoUpload(): void {
  void active?.trigger();
}
