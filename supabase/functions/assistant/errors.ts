/**
 * Errores de la función como JSON limpio `{ code, message }`. La app traduce
 * el `code` (y el estado HTTP) a sus propios mensajes en español y pasa al
 * asistente básico.
 *
 * Los errores de Anthropic se distinguen por su clase (las del SDK, que
 * `index.ts` inyecta), nunca por el texto del mensaje.
 */

export type ErrorCode =
  | 'not_configured'
  | 'unauthorized'
  | 'invalid_request'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'overloaded'
  | 'ai_auth'
  | 'ai_unavailable'
  | 'ai_error'
  | 'internal';

export interface ErrorResponse {
  readonly status: number;
  readonly body: { readonly code: ErrorCode; readonly message: string };
}

export function errorResponse(status: number, code: ErrorCode, message: string): ErrorResponse {
  return { status, body: { code, message } };
}

type ErrorClass = abstract new (...args: never[]) => Error;

/** Clases de error del SDK de Anthropic que se reconocen. */
export interface AnthropicErrorClasses {
  readonly APIError: ErrorClass;
  readonly APIConnectionError: ErrorClass;
  readonly AuthenticationError: ErrorClass;
  readonly PermissionDeniedError: ErrorClass;
  readonly RateLimitError: ErrorClass;
  readonly BadRequestError: ErrorClass;
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};

/** Error de la llamada a Claude → respuesta HTTP de la función. */
export function mapAnthropicError(error: unknown, classes: AnthropicErrorClasses): ErrorResponse {
  if (error instanceof classes.RateLimitError) {
    return errorResponse(
      429,
      'rate_limited',
      'Demasiadas consultas a la IA. Intenta en un momento.',
    );
  }
  if (
    error instanceof classes.AuthenticationError ||
    error instanceof classes.PermissionDeniedError
  ) {
    return errorResponse(503, 'ai_auth', 'La clave de la IA no es válida o no tiene permisos.');
  }
  // APIConnectionError hereda de APIError: va antes.
  if (error instanceof classes.APIConnectionError) {
    return errorResponse(502, 'ai_unavailable', 'No se pudo conectar con la IA.');
  }
  if (error instanceof classes.BadRequestError) {
    return errorResponse(502, 'ai_error', 'La IA rechazó la petición.');
  }
  if (error instanceof classes.APIError) {
    const status = statusOf(error);
    if (status === 529)
      return errorResponse(503, 'overloaded', 'La IA está saturada en este momento.');
    return errorResponse(502, 'ai_unavailable', 'La IA no está disponible en este momento.');
  }
  return errorResponse(500, 'internal', 'Error interno del asistente.');
}
