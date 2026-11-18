import { colors } from '@/theme';

import {
  isUploaded,
  needsUpload,
  parsePhotoSyncStatus,
  photoCountLabel,
  photoFromRow,
  photoSyncInfo,
  type PhotoSyncStatus,
  hasStamp,
} from '../photo.model';

describe('photoFromRow', () => {
  it('convierte una fila completa', () => {
    expect(
      photoFromRow({
        id: 'p1',
        visit_id: 'v1',
        form_field_id: 'campo_1',
        local_path: 'teins_photos/p1.jpg',
        storage_path: 'visits/v1/photos/p1.jpg',
        storage_url: 'https://x/storage/v1/object/visit-photos/visits/v1/photos/p1.jpg',
        caption: '  Tablero  ',
        sync_status: 'uploaded',
        captured_at: '2026-06-01T08:00:00.000Z',
        uploaded_at: '2026-06-01T08:01:00.000Z',
        file_size_bytes: 123456,
        width: 1920,
        height: 1080,
      }),
    ).toEqual({
      id: 'p1',
      visitId: 'v1',
      formFieldId: 'campo_1',
      localPath: 'teins_photos/p1.jpg',
      storagePath: 'visits/v1/photos/p1.jpg',
      storageUrl: 'https://x/storage/v1/object/visit-photos/visits/v1/photos/p1.jpg',
      caption: 'Tablero',
      syncStatus: 'uploaded',
      capturedAt: '2026-06-01T08:00:00.000Z',
      uploadedAt: '2026-06-01T08:01:00.000Z',
      fileSizeBytes: 123456,
      width: 1920,
      height: 1080,
      // Foto anterior a la marca impresa: sin ubicación ni hora impresa.
      latitude: null,
      longitude: null,
      locationAccuracy: null,
      takenAt: null,
    });
  });

  it('lee la ubicación, la precisión y la hora impresas (marca)', () => {
    const photo = photoFromRow({
      id: 'p2',
      visit_id: 'v1',
      local_path: 'teins_photos/p2.jpg',
      sync_status: 'local',
      captured_at: '2026-06-01T08:00:00.000Z',
      latitude: -3.993421,
      longitude: '-79.204512',
      location_accuracy: 8,
      taken_at: '2026-06-01T07:59:58.000Z',
    });
    expect(photo).toMatchObject({
      latitude: -3.993421,
      longitude: -79.204512,
      locationAccuracy: 8,
      takenAt: '2026-06-01T07:59:58.000Z',
    });
    expect(hasStamp(photo)).toBe(true);
    expect(hasStamp({ takenAt: null })).toBe(false);
  });

  it('usa valores por defecto con columnas vacías o desconocidas', () => {
    const photo = photoFromRow({ id: 'p2', sync_status: 'raro', caption: '', width: null });
    expect(photo.syncStatus).toBe('local');
    expect(photo.caption).toBeNull();
    expect(photo.storagePath).toBeNull();
    expect(photo.width).toBeNull();
    expect(photo.localPath).toBe('');
  });
});

describe('estado de subida', () => {
  it.each<[PhotoSyncStatus, string, string]>([
    ['local', 'En el dispositivo', colors.pendingSync],
    ['pendingUpload', 'Por subir', colors.pendingSync],
    ['uploading', 'Subiendo', colors.syncing],
    ['uploaded', 'Subida', colors.online],
    ['uploadError', 'Error al subir', colors.error],
  ])('%s → "%s"', (status, label, color) => {
    expect(photoSyncInfo(status)).toEqual({ label, color });
    expect(parsePhotoSyncStatus(status)).toBe(status);
  });

  it('needsUpload solo para local, pendingUpload y uploadError', () => {
    expect(needsUpload({ syncStatus: 'local' })).toBe(true);
    expect(needsUpload({ syncStatus: 'pendingUpload' })).toBe(true);
    expect(needsUpload({ syncStatus: 'uploadError' })).toBe(true);
    expect(needsUpload({ syncStatus: 'uploading' })).toBe(false);
    expect(needsUpload({ syncStatus: 'uploaded' })).toBe(false);
  });

  it('isUploaded solo para uploaded', () => {
    expect(isUploaded({ syncStatus: 'uploaded' })).toBe(true);
    expect(isUploaded({ syncStatus: 'uploading' })).toBe(false);
  });

  it('etiqueta de conteo en singular y plural', () => {
    expect(photoCountLabel(1)).toBe('1 fotografía');
    expect(photoCountLabel(0)).toBe('0 fotografías');
    expect(photoCountLabel(12)).toBe('12 fotografías');
  });
});
