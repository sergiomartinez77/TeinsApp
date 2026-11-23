/**
 * Configuración del asistente desde los secretos de la función
 * (Supabase Dashboard → Edge Functions → Secrets).
 *
 * - ANTHROPIC_API_KEY: sin ella la función responde 503 `not_configured` y la
 *   app usa el asistente básico (gratis, en el teléfono).
 * - ASSISTANT_MODEL: `claude-haiku-5-5` (por defecto, el más barato),
 *   `claude-sonnet-5-5` o `claude-opus-5-5`. Cambiarlo no requiere otra
 *   versión de la app.
 * - ASSISTANT_EFFORT (opcional): `low` (por defecto, chat) o `medium`.
 *
 * Módulo puro (sin Deno): lo prueban los tests de jest.
 */

export const ALLOWED_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const;
export type AssistantModel = (typeof ALLOWED_MODELS)[number];
export const DEFAULT_MODEL: AssistantModel = 'claude-haiku-5-5';

export const ALLOWED_EFFORTS = ['low', 'medium'] as const;
export type AssistantEffort = (typeof ALLOWED_EFFORTS)[number];

/**
 * Cabecera beta del reintento en otro modelo cuando un clasificador de
 * seguridad rechaza la petición (`fallbacks: "default"`). Solo Opus 5.5 y
 * Sonnet 5.5 lo admiten; Claude Haiku 5.5 no tiene reintento en el servidor
 * (enviarlo da error), así que con Haiku el rechazo se maneja en la respuesta.
 */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Tope de tokens de salida (incluye el razonamiento adaptativo del modelo). */
export const MAX_OUTPUT_TOKENS = 4096;
/** Vueltas máximas del bucle de herramientas por pregunta. */
export const MAX_TOOL_ITERATIONS = 6;

export interface AssistantConfig {
  readonly apiKey: string | null;
  readonly model: AssistantModel;
  readonly effort: AssistantEffort;
  readonly maxTokens: number;
  /** Enviar `fallbacks: "default"` (Opus 5.5 y Sonnet 5.5). */
  readonly useFallbacks: boolean;
  /** Valor de ASSISTANT_MODEL no reconocido (se usa el modelo por defecto). */
  readonly invalidModel: string | null;
}

export type EnvReader = (name: string) => string | undefined;

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value);

export function readConfig(env: EnvReader): AssistantConfig {
  const apiKey = env('ANTHROPIC_API_KEY')?.trim() || null;
  const rawModel = env('ASSISTANT_MODEL')?.trim() ?? '';
  const model = isOneOf(ALLOWED_MODELS, rawModel) ? rawModel : DEFAULT_MODEL;
  const rawEffort = env('ASSISTANT_EFFORT')?.trim() ?? '';
  const effort = isOneOf(ALLOWED_EFFORTS, rawEffort) ? rawEffort : 'low';
  return {
    apiKey,
    model,
    effort,
    maxTokens: MAX_OUTPUT_TOKENS,
    useFallbacks: model !== 'claude-haiku-5-5',
    invalidModel: rawModel && rawModel !== model ? rawModel : null,
  };
}
