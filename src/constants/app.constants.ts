/**
 * Constantes globales. Centralizarlas evita textos y números mágicos dispersos.
 */

/** Claves del almacenamiento seguro (Keystore en Android, Keychain en iOS). */
export const SECURE_KEYS = {
  /** Sesión de Supabase: incluye el token de acceso y el de refresco. */
  authSession: 'auth_token',
  userId: 'user_id',
  /** Perfil del usuario, para abrir la app sin conexión sin esperar a la red. */
  userProfile: 'user_profile',
  lastSync: 'last_sync_timestamp',
  /**
   * Usuario al que pertenecen los datos de la base local. No se borra al
   * cerrar sesión: sirve para detectar si entra una persona distinta.
   */
  databaseOwner: 'db_owner_id',
} as const;

/** Archivos de base de datos local. */
export const DATABASE = {
  /** Base sincronizada del técnico. */
  mainFile: 'teins_local.db',
  /** Base aislada del modo demo: nunca se conecta ni se sincroniza. */
  demoFile: 'teins_demo.db',
} as const;

export const SYNC = {
  /** Si el token vence en menos de este tiempo, se refresca antes de usarlo. */
  tokenRefreshMarginMs: 5 * 60 * 1000,
} as const;

export const PHOTOS = {
  maxWidth: 1920,
  maxHeight: 1080,
  /** Calidad JPEG (0–1). */
  jpegQuality: 0.85,
  maxBytes: 5 * 1024 * 1024,
  /** Carpeta dentro del directorio de documentos de la app. */
  localDirectory: 'teins_photos',
  bucket: 'visit-photos',
  thumbnailWidth: 300,
} as const;

/** Ruta en Supabase Storage: visits/{visitId}/photos/{photoId}.jpg */
export function photoStoragePath(visitId: string, photoId: string): string {
  return `visits/${visitId}/photos/${photoId}.jpg`;
}

export const AUTOSAVE = {
  formDebounceMs: 800,
  annotationDebounceMs: 1600,
} as const;

export const PAGE_SIZE = {
  visits: 20,
  materials: 30,
  photos: 20,
} as const;

export const ANNOTATIONS = {
  maxUndoStates: 20,
} as const;

export const UI = {
  animationMs: 250,
} as const;
