import { ids, photoRow, TECH_A, TECH_B, visitRow } from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import { createPhotoUploader } from '../services/photo-uploader';
import {
  DELETE_PHOTO_SQL,
  OWN_VISIT_SQL,
  PENDING_UPLOAD_COUNT_SQL,
  PENDING_UPLOADS_SQL,
  PHOTO_BY_ID_SQL,
  RESET_INTERRUPTED_UPLOADS_SQL,
  VISIT_PHOTO_COUNT_SQL,
  VISIT_PHOTO_STATS_SQL,
  VISIT_PHOTOS_SQL,
} from '../services/photo.queries';
import { addPhoto, deletePhoto, PHOTO_SERVICE_MESSAGES } from '../services/photo.service';

import { createFakeFiles } from './fakes';

/** Consultas y escrituras de fotografías ejecutadas contra SQLite real. */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});
jest.mock('@/services/connectivity/connectivity.service', () => ({
  isOnline: jest.fn(() => true),
  subscribeConnectivity: jest.fn(() => () => undefined),
}));
jest.mock('../services/photo-storage', () => ({
  supabasePhotoStorage: { upload: jest.fn(), objectUrl: jest.fn() },
}));

const NOW = new Date('2026-06-10T12:00:00.000Z');
const IMAGE = { uri: 'file:///cache/comprimida.jpg', width: 1600, height: 900 };

let db: TestDatabase;

beforeEach(() => {
  resetIds('foto');
  db = createTestDatabase();
  db.insert('visits', [
    visitRow({ id: 'v1', status: 'inProgress' }),
    visitRow({ id: 'v2', status: 'inProgress' }),
    visitRow({ id: 'v-cerrada', status: 'completed' }),
    visitRow({ id: 'v-ajena', technician_id: TECH_B, status: 'inProgress' }),
  ]);
});

describe('consultas de la galería', () => {
  beforeEach(() => {
    db.insert('photos', [
      photoRow({ id: 'p-a', captured_at: '2026-06-01T08:00:00.000Z', sync_status: 'uploaded' }),
      photoRow({ id: 'p-c', captured_at: '2026-06-03T08:00:00.000Z', sync_status: 'local' }),
      photoRow({ id: 'p-b', captured_at: '2026-06-03T08:00:00.000Z', sync_status: 'uploadError' }),
      photoRow({ id: 'p-d', captured_at: '2026-06-02T08:00:00.000Z', sync_status: 'uploading' }),
      photoRow({
        id: 'p-e',
        captured_at: '2026-06-04T08:00:00.000Z',
        sync_status: 'pendingUpload',
      }),
      photoRow({ id: 'p-v2', visit_id: 'v2', sync_status: 'local' }),
      photoRow({ id: 'p-ajena', visit_id: 'v-ajena', sync_status: 'local' }),
    ]);
  });

  it('VISIT_PHOTOS_SQL: de la más reciente a la más antigua (empate por id) y con límite', async () => {
    expect(ids(await db.getAll<Row>(VISIT_PHOTOS_SQL, ['v1', 10]))).toEqual([
      'p-e',
      'p-c',
      'p-b',
      'p-d',
      'p-a',
    ]);
    expect(ids(await db.getAll<Row>(VISIT_PHOTOS_SQL, ['v1', 2]))).toEqual(['p-e', 'p-c']);
  });

  it('VISIT_PHOTO_COUNT_SQL cuenta las fotos de la visita', async () => {
    expect(await db.get(VISIT_PHOTO_COUNT_SQL, ['v1'])).toEqual({ count: 5 });
    expect(await db.get(VISIT_PHOTO_COUNT_SQL, ['sin-fotos'])).toEqual({ count: 0 });
  });

  it('VISIT_PHOTO_STATS_SQL: total y pendientes de subir, solo en visitas del técnico', async () => {
    // Pendientes: local, pendingUpload y uploadError (no "uploading" ni "uploaded").
    expect(await db.get(VISIT_PHOTO_STATS_SQL, ['v1', TECH_A])).toEqual({ total: 5, pending: 3 });
    expect(await db.get(VISIT_PHOTO_STATS_SQL, ['v-ajena', TECH_A])).toEqual({
      total: 0,
      pending: 0,
    });
    expect(await db.get(VISIT_PHOTO_STATS_SQL, ['v-ajena', TECH_B])).toEqual({
      total: 1,
      pending: 1,
    });
  });

  it('cola de subida: pendientes del técnico, de la más antigua a la más reciente', async () => {
    expect(await db.getAll(PENDING_UPLOADS_SQL, [TECH_A])).toEqual([
      { id: 'p-v2', visit_id: 'v2', local_path: 'teins_photos/p1.jpg' },
      { id: 'p-b', visit_id: 'v1', local_path: 'teins_photos/p1.jpg' },
      { id: 'p-c', visit_id: 'v1', local_path: 'teins_photos/p1.jpg' },
      { id: 'p-e', visit_id: 'v1', local_path: 'teins_photos/p1.jpg' },
    ]);
    expect(await db.get(PENDING_UPLOAD_COUNT_SQL, [TECH_A])).toEqual({ count: 4 });
    expect(await db.get(PENDING_UPLOAD_COUNT_SQL, [TECH_B])).toEqual({ count: 1 });
  });

  it('RESET_INTERRUPTED_UPLOADS_SQL devuelve a la cola solo las "subiendo" del técnico', async () => {
    db.insert('photos', [
      photoRow({ id: 'p-ajena-subiendo', visit_id: 'v-ajena', sync_status: 'uploading' }),
    ]);
    await db.execute(RESET_INTERRUPTED_UPLOADS_SQL, [TECH_A]);
    expect((await db.get<Row>(PHOTO_BY_ID_SQL, ['p-d', 'v1'])).sync_status).toBe('pendingUpload');
    expect((await db.get<Row>(PHOTO_BY_ID_SQL, ['p-ajena-subiendo', 'v-ajena'])).sync_status).toBe(
      'uploading',
    );
  });

  it('PHOTO_BY_ID_SQL, OWN_VISIT_SQL y DELETE_PHOTO_SQL', async () => {
    expect(await db.getOptional(PHOTO_BY_ID_SQL, ['p-a', 'v2'])).toBeNull();
    expect(await db.getOptional(OWN_VISIT_SQL, ['v-ajena', TECH_A])).toBeNull();
    await db.execute(DELETE_PHOTO_SQL, ['p-a']);
    expect(await db.getOptional(PHOTO_BY_ID_SQL, ['p-a', 'v1'])).toBeNull();
  });
});

describe('photo.service contra SQLite real (sistema de archivos falso)', () => {
  it('registra la foto como local y mueve el archivo a teins_photos/<id>.jpg', async () => {
    const { files, stored } = createFakeFiles();

    const result = await addPhoto(db, files, TECH_A, { visitId: 'v1', image: IMAGE }, NOW);

    expect(result.ok).toBe(true);
    expect(await db.getAll(VISIT_PHOTOS_SQL, ['v1', 10])).toEqual([
      {
        id: 'foto-1',
        visit_id: 'v1',
        form_field_id: null,
        local_path: 'teins_photos/foto-1.jpg',
        storage_path: null,
        storage_url: null,
        caption: null,
        sync_status: 'local',
        captured_at: NOW.toISOString(),
        uploaded_at: null,
        file_size_bytes: 2048,
        width: 1600,
        height: 900,
      },
    ]);
    expect(stored.has('teins_photos/foto-1.jpg')).toBe(true);
    expect(await db.get(VISIT_PHOTO_STATS_SQL, ['v1', TECH_A])).toEqual({ total: 1, pending: 1 });
  });

  it('no registra fotos en visitas cerradas ni ajenas', async () => {
    const { files } = createFakeFiles();
    const closed = await addPhoto(db, files, TECH_A, { visitId: 'v-cerrada', image: IMAGE }, NOW);
    expect(!closed.ok && closed.error.message).toBe(PHOTO_SERVICE_MESSAGES.visitClosed);
    const foreign = await addPhoto(db, files, TECH_A, { visitId: 'v-ajena', image: IMAGE }, NOW);
    expect(!foreign.ok && foreign.error.message).toBe(PHOTO_SERVICE_MESSAGES.visitNotFound);
    expect(db.rows('photos')).toEqual([]);
    expect(files.save).not.toHaveBeenCalled();
  });

  it('si el INSERT falla en SQLite, no queda fila y se borra el archivo ya guardado', async () => {
    const { files, stored } = createFakeFiles();
    db.raw.exec(`CREATE TRIGGER fallo BEFORE INSERT ON photos
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);

    const result = await addPhoto(db, files, TECH_A, { visitId: 'v1', image: IMAGE }, NOW);

    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('photos')).toEqual([]);
    expect(stored.size).toBe(0);
  });

  it('elimina la fila y manda el archivo no subido a la papelera', async () => {
    const { files, stored, trash } = createFakeFiles({ 'teins_photos/p1.jpg': 500 });
    db.insert('photos', [photoRow({ id: 'p1', sync_status: 'local' })]);

    const result = await deletePhoto(db, files, TECH_A, { visitId: 'v1', photoId: 'p1' }, NOW);

    expect(result.ok).toBe(true);
    expect(db.rows('photos')).toEqual([]);
    expect(stored.size).toBe(0);
    expect([...trash.keys()]).toEqual([`${NOW.getTime()}_p1.jpg`]);
  });

  it('borrar una foto inexistente o de otra visita no toca nada', async () => {
    const { files } = createFakeFiles();
    db.insert('photos', [photoRow({ id: 'p1', visit_id: 'v2' })]);
    const result = await deletePhoto(db, files, TECH_A, { visitId: 'v1', photoId: 'p1' }, NOW);
    expect(!result.ok && result.error.message).toBe(PHOTO_SERVICE_MESSAGES.photoNotFound);
    expect(db.rows('photos')).toHaveLength(1);
  });
});

describe('gestor de subidas contra SQLite real', () => {
  it('sube las pendientes del técnico y las marca como subidas', async () => {
    db.insert('photos', [
      photoRow({
        id: 'p1',
        local_path: 'teins_photos/p1.jpg',
        captured_at: '2026-06-01T00:00:00.000Z',
      }),
      photoRow({ id: 'p2', local_path: 'teins_photos/p2.jpg', sync_status: 'uploading' }),
      photoRow({ id: 'p-ajena', visit_id: 'v-ajena', local_path: 'teins_photos/x.jpg' }),
    ]);
    const { files } = createFakeFiles({
      'teins_photos/p1.jpg': 10,
      'teins_photos/p2.jpg': 10,
      'teins_photos/x.jpg': 10,
    });
    const storage = {
      upload: jest.fn(async () => undefined),
      objectUrl: (path: string) => `https://almacen.example/${path}`,
    };
    const timer = { setTimeout: jest.fn(), clearTimeout: jest.fn() };

    const uploader = createPhotoUploader({
      db,
      technicianId: TECH_A,
      storage,
      files,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      timer,
      now: () => NOW,
    });
    await uploader.trigger();
    uploader.stop();

    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(await db.get<Row>(PHOTO_BY_ID_SQL, ['p1', 'v1'])).toMatchObject({
      sync_status: 'uploaded',
      storage_path: 'visits/v1/photos/p1.jpg',
      storage_url: 'https://almacen.example/visits/v1/photos/p1.jpg',
      uploaded_at: NOW.toISOString(),
    });
    expect((await db.get<Row>(PHOTO_BY_ID_SQL, ['p2', 'v1'])).sync_status).toBe('uploaded');
    expect((await db.get<Row>(PHOTO_BY_ID_SQL, ['p-ajena', 'v-ajena'])).sync_status).toBe('local');
    expect(await db.get(PENDING_UPLOAD_COUNT_SQL, [TECH_A])).toEqual({ count: 0 });
    // Sin pendientes no se programa reintento.
    expect(timer.setTimeout).not.toHaveBeenCalled();
  });
});
