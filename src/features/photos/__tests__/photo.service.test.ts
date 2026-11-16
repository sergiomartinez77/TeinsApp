import type { PhotoSyncStatus } from '@/models/photo.model';

import { addPhoto, deletePhoto, PHOTO_SERVICE_MESSAGES } from '../services/photo.service';

import { createFakeFiles, createPhotoDb, photoRow, visitRow } from './fakes';

let mockIdCounter = 0;
jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/utils/uuid.utils', () => ({
  generateId: () => {
    mockIdCounter += 1;
    return `foto-${mockIdCounter}`;
  },
}));

const NOW = new Date('2026-06-01T10:00:00.000Z');
const IMAGE = { uri: 'file:///cache/temporal.jpg', width: 1920, height: 1080 };

beforeEach(() => {
  mockIdCounter = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('addPhoto', () => {
  it('guarda el archivo y la fila con ruta relativa y metadatos reales', async () => {
    const { db, photos } = createPhotoDb();
    const { files, stored } = createFakeFiles();

    const result = await addPhoto(db, files, 't1', { visitId: 'v1', image: IMAGE }, NOW);

    expect(result.ok).toBe(true);
    expect(files.save).toHaveBeenCalledWith(IMAGE.uri, 'teins_photos/foto-1.jpg');
    expect(stored.has('teins_photos/foto-1.jpg')).toBe(true);
    expect(photos().get('foto-1')).toEqual({
      id: 'foto-1',
      visit_id: 'v1',
      form_field_id: null,
      local_path: 'teins_photos/foto-1.jpg',
      storage_path: null,
      storage_url: null,
      caption: null,
      sync_status: 'local',
      captured_at: '2026-06-01T10:00:00.000Z',
      uploaded_at: null,
      file_size_bytes: 2048,
      width: 1920,
      height: 1080,
    });
    if (result.ok) {
      expect(result.data.localPath).toBe('teins_photos/foto-1.jpg');
      expect(result.data.syncStatus).toBe('local');
    }
  });

  it('rechaza una visita cerrada sin escribir nada', async () => {
    const { db, photos } = createPhotoDb({ visits: [visitRow({ status: 'completed' })] });
    const { files } = createFakeFiles();

    const result = await addPhoto(db, files, 't1', { visitId: 'v1', image: IMAGE }, NOW);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: PHOTO_SERVICE_MESSAGES.visitClosed }),
    });
    expect(files.save).not.toHaveBeenCalled();
    expect(photos().size).toBe(0);
  });

  it('rechaza una visita ajena o inexistente sin escribir nada', async () => {
    const { db, photos } = createPhotoDb({ visits: [visitRow({ technician_id: 'otro' })] });
    const { files } = createFakeFiles();

    const result = await addPhoto(db, files, 't1', { visitId: 'v1', image: IMAGE }, NOW);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: PHOTO_SERVICE_MESSAGES.visitNotFound }),
    });
    expect(files.save).not.toHaveBeenCalled();
    expect(photos().size).toBe(0);
  });

  it('si falla el INSERT borra el archivo recién creado', async () => {
    const { db, photos, failNextWrite } = createPhotoDb();
    const { files, stored } = createFakeFiles();
    failNextWrite(new Error('disco lleno'));

    const result = await addPhoto(db, files, 't1', { visitId: 'v1', image: IMAGE }, NOW);

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: 'database' }) });
    expect(files.remove).toHaveBeenCalledWith('teins_photos/foto-1.jpg');
    expect(stored.size).toBe(0);
    expect(photos().size).toBe(0);
  });
});

describe('deletePhoto', () => {
  const PATH = 'teins_photos/p1.jpg';

  it.each<PhotoSyncStatus>(['local', 'pendingUpload', 'uploadError', 'uploading'])(
    'con estado %s borra la fila y CONSERVA el archivo local',
    async (status) => {
      const { db, photos } = createPhotoDb({ photos: [photoRow({ sync_status: status })] });
      const { files, stored } = createFakeFiles({ [PATH]: 1000 });

      const result = await deletePhoto(db, files, 't1', { visitId: 'v1', photoId: 'p1' });

      expect(result.ok).toBe(true);
      expect(photos().has('p1')).toBe(false);
      expect(files.remove).not.toHaveBeenCalled();
      expect(stored.has(PATH)).toBe(true);
    },
  );

  it('con estado uploaded borra la fila y el archivo local', async () => {
    const { db, photos } = createPhotoDb({
      photos: [
        photoRow({
          sync_status: 'uploaded',
          storage_path: 'visits/v1/photos/p1.jpg',
          storage_url: 'https://ejemplo/visits/v1/photos/p1.jpg',
        }),
      ],
    });
    const { files, stored } = createFakeFiles({ [PATH]: 1000 });

    const result = await deletePhoto(db, files, 't1', { visitId: 'v1', photoId: 'p1' });

    expect(result.ok).toBe(true);
    expect(photos().has('p1')).toBe(false);
    expect(files.remove).toHaveBeenCalledWith(PATH);
    expect(stored.has(PATH)).toBe(false);
  });

  it('en una visita cerrada no borra nada', async () => {
    const { db, photos } = createPhotoDb({
      visits: [visitRow({ status: 'synced' })],
      photos: [photoRow({ sync_status: 'uploaded' })],
    });
    const { files, stored } = createFakeFiles({ [PATH]: 1000 });

    const result = await deletePhoto(db, files, 't1', { visitId: 'v1', photoId: 'p1' });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: PHOTO_SERVICE_MESSAGES.visitClosed }),
    });
    expect(photos().has('p1')).toBe(true);
    expect(stored.has(PATH)).toBe(true);
  });

  it('avisa si la foto ya no existe', async () => {
    const { db } = createPhotoDb();
    const { files } = createFakeFiles();

    const result = await deletePhoto(db, files, 't1', { visitId: 'v1', photoId: 'p9' });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: PHOTO_SERVICE_MESSAGES.photoNotFound }),
    });
  });
});
