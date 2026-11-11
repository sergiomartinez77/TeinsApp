/**
 * Errores tipados de la aplicación (equivalente a la jerarquía `Failure` original).
 *
 * `message` es siempre un texto en español apto para mostrar al usuario,
 * sin jerga técnica. `cause` es el error original y solo se usa para logs.
 */
export type AppErrorKind =
  | 'network'
  | 'server'
  | 'authentication'
  | 'sessionExpired'
  | 'unauthorized'
  | 'database'
  | 'sync'
  | 'conflict'
  | 'validation'
  | 'permission'
  | 'storage'
  | 'unknown';

export interface AppError {
  readonly kind: AppErrorKind;
  readonly message: string;
  /** Código interno opcional para diagnóstico. */
  readonly code?: string;
  /** Error original. Nunca se muestra al usuario. */
  readonly cause?: unknown;
}

/** Mensajes por defecto, idénticos a los de la app original. */
export const DEFAULT_ERROR_MESSAGES: Record<Exclude<AppErrorKind, 'validation'>, string> = {
  network:
    'Sin conexión. Los cambios se guardarán en el dispositivo y se sincronizarán automáticamente cuando vuelva Internet.',
  server: 'El servidor no está disponible en este momento. Tus datos locales están seguros.',
  authentication: 'Credenciales incorrectas. Verifica tu usuario y contraseña.',
  sessionExpired: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
  unauthorized: 'No tienes permiso para realizar esta acción.',
  database: 'Error al acceder a los datos locales. Por favor intenta nuevamente.',
  sync: 'No se pudo sincronizar. Tus datos siguen guardados localmente.',
  conflict:
    'Se detectó un conflicto en la sincronización. La información ha sido preservada para revisión.',
  permission:
    'Se necesita permiso para continuar. Por favor actívalo en la configuración del dispositivo.',
  storage:
    'Error al guardar o cargar el archivo. Verifica el espacio disponible en el dispositivo.',
  unknown: 'Ha ocurrido un error inesperado. Por favor intenta nuevamente.',
};

interface AppErrorOptions {
  message?: string;
  code?: string;
  cause?: unknown;
}

/** Crea un error tipado; si no se indica mensaje usa el texto por defecto del tipo. */
export function appError(
  kind: Exclude<AppErrorKind, 'validation'>,
  options: AppErrorOptions = {},
): AppError {
  return {
    kind,
    message: options.message ?? DEFAULT_ERROR_MESSAGES[kind],
    code: options.code,
    cause: options.cause,
  };
}

/** Los errores de validación siempre llevan un mensaje específico. */
export function validationError(message: string, code?: string): AppError {
  return { kind: 'validation', message, code };
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

/**
 * Convierte cualquier valor capturado en un `catch` en un AppError.
 * Los errores ya tipados se devuelven tal cual.
 */
export function toAppError(
  value: unknown,
  fallbackKind: Exclude<AppErrorKind, 'validation'> = 'unknown',
): AppError {
  if (isAppError(value)) return value;
  return appError(fallbackKind, { cause: value });
}

/** Resultado explícito de una operación (equivalente a `Either<Failure, T>`). */
export type Result<T, E = AppError> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: E };

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function err<E = AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}
