import { colors } from '@/theme';

// ── Estado de subida ─────────────────────────────────────────────────────────

/**
 * Estado de subida de una fotografía (enum propio, distinto del de los demás
 * registros): el archivo vive primero en el dispositivo y luego se sube a
 * Supabase Storage.
 */
export type PhotoSyncStatus = 'local' | 'pendingUpload' | 'uploading' | 'uploaded' | 'uploadError';

const PHOTO_SYNC_STATUSES: readonly PhotoSyncStatus[] = [
  'local',
  'pendingUpload',
  'uploading',
  'uploaded',
  'uploadError',
];

export function parsePhotoSyncStatus(value: unknown): PhotoSyncStatus {
  return PHOTO_SYNC_STATUSES.find((status) => status === value) ?? 'local';
}

/** Estados en los que la foto todavía debe subirse. */
export const PENDING_UPLOAD_STATUSES: readonly PhotoSyncStatus[] = [
  'local',
  'pendingUpload',
  'uploadError',
];

export interface PhotoSyncInfo {
  /** Texto para mostrar y para lectores de pantalla (no depender solo del color). */
  label: string;
  color: string;
}

export const PHOTO_SYNC_INFO: Readonly<Record<PhotoSyncStatus, PhotoSyncInfo>> = {
  local: { label: 'En el dispositivo', color: colors.pendingSync },
  pendingUpload: { label: 'Por subir', color: colors.pendingSync },
  uploading: { label: 'Subiendo', color: colors.syncing },
  uploaded: { label: 'Subida', color: colors.online },
  uploadError: { label: 'Error al subir', color: colors.error },
};

// ── Entidad ──────────────────────────────────────────────────────────────────

/** Fotografía de una visita. Las fechas son texto ISO 8601 en UTC. */
export interface VisitPhoto {
  readonly id: string;
  readonly visitId: string;
  readonly formFieldId: string | null;
  /** Ruta RELATIVA al directorio de documentos: `teins_photos/<id>.jpg`. */
  readonly localPath: string;
  readonly storagePath: string | null;
  readonly storageUrl: string | null;
  readonly caption: string | null;
  readonly syncStatus: PhotoSyncStatus;
  readonly capturedAt: string;
  readonly uploadedAt: string | null;
  readonly fileSizeBytes: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

const optionalText = (value: unknown): string | null => {
  const result = text(value).trim();
  return result.length > 0 ? result : null;
};

const optionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

/** Convierte una fila de SQLite en una fotografía. */
export function photoFromRow(row: Record<string, unknown>): VisitPhoto {
  return {
    id: text(row.id),
    visitId: text(row.visit_id),
    formFieldId: optionalText(row.form_field_id),
    localPath: text(row.local_path),
    storagePath: optionalText(row.storage_path),
    storageUrl: optionalText(row.storage_url),
    caption: optionalText(row.caption),
    syncStatus: parsePhotoSyncStatus(row.sync_status),
    capturedAt: text(row.captured_at),
    uploadedAt: optionalText(row.uploaded_at),
    fileSizeBytes: optionalNumber(row.file_size_bytes),
    width: optionalNumber(row.width),
    height: optionalNumber(row.height),
  };
}

export function photoSyncInfo(status: PhotoSyncStatus): PhotoSyncInfo {
  return PHOTO_SYNC_INFO[status];
}

export function isUploaded(photo: Pick<VisitPhoto, 'syncStatus'>): boolean {
  return photo.syncStatus === 'uploaded';
}

/** La foto está pendiente de subir (nueva, en cola o con un error anterior). */
export function needsUpload(photo: Pick<VisitPhoto, 'syncStatus'>): boolean {
  return PENDING_UPLOAD_STATUSES.includes(photo.syncStatus);
}

/** "1 fotografía" o "N fotografías". */
export function photoCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'fotografía' : 'fotografías'}`;
}
