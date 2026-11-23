import { readConfig, type AssistantConfig, type EnvReader } from './config.ts';
import { errorResponse, mapAnthropicError, type AnthropicErrorClasses } from './errors.ts';
import { runConversation } from './loop.ts';
import { buildSystem } from './prompt.ts';
import { executeTool, TOOL_DEFINITIONS } from './tools.ts';
import type { AnthropicLike, ApiMessageParam, DbLike, GuideJson, SharePdfAction } from './types.ts';

/**
 * Lógica de la petición (sin Deno: `index.ts` solo la conecta con
 * `Deno.serve`, Supabase y el SDK de Anthropic).
 *
 * Petición:  { messages: [{ role: 'user' | 'assistant', content: string }], timezoneOffsetMinutes? }
 * Respuesta: { text, actions, model }  o  { code, message } con estado de error.
 */

export const MAX_TURNS = 12;
export const MAX_TURN_CHARS = 2000;

/** Sesión del usuario que llama: cliente con su token (RLS) y su id. */
export interface UserSession {
  readonly db: DbLike;
  /** Id del usuario del token, o `null` si no es válido. */
  readonly getUserId: () => Promise<string | null>;
}

export interface HandlerDeps {
  readonly env: EnvReader;
  /** Cabecera `Authorization` (`Bearer <jwt>`). */
  readonly authorization: string | null;
  readonly body: unknown;
  readonly now: Date;
  readonly guide: GuideJson;
  readonly createSession: (authorization: string) => UserSession;
  readonly createAnthropic: (config: AssistantConfig & { apiKey: string }) => AnthropicLike;
  readonly errorClasses: AnthropicErrorClasses;
  readonly log?: (message: string, detail?: unknown) => void;
}

export interface HandlerResponse {
  readonly status: number;
  readonly body:
    | { readonly text: string; readonly actions: readonly SharePdfAction[]; readonly model: string }
    | { readonly code: string; readonly message: string };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Historial válido: últimos turnos, recortados, empezando y terminando en el usuario. */
export function parseMessages(body: unknown): ApiMessageParam[] | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) return null;
  const turns: ApiMessageParam[] = [];
  for (const item of body.messages) {
    if (!isRecord(item)) continue;
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    if (typeof item.content !== 'string' || !item.content.trim()) continue;
    turns.push({ role: item.role, content: item.content.trim().slice(0, MAX_TURN_CHARS) });
  }
  const recent = turns.slice(-MAX_TURNS);
  while (recent.length > 0 && recent[0]?.role !== 'user') recent.shift();
  if (recent.length === 0 || recent[recent.length - 1]?.role !== 'user') return null;
  return recent;
}

/** Desfase horario del teléfono, acotado a ±14 h. */
export function parseTimezoneOffset(body: unknown): number {
  const value = isRecord(body) ? body.timezoneOffsetMinutes : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-840, Math.min(840, Math.round(value)));
}

async function readRole(
  db: DbLike,
  userId: string,
): Promise<{ role: string; fullName: string | null }> {
  const { data } = await db
    .from('profiles')
    .select('role, full_name')
    .eq('id', userId)
    .maybeSingle();
  const row = isRecord(data) ? data : {};
  return {
    role: typeof row.role === 'string' ? row.role : 'technician',
    fullName: typeof row.full_name === 'string' && row.full_name.trim() ? row.full_name : null,
  };
}

export async function handleAssistantRequest(deps: HandlerDeps): Promise<HandlerResponse> {
  const config = readConfig(deps.env);
  if (!config.apiKey) {
    return errorResponse(
      503,
      'not_configured',
      'El asistente con IA no está activado (falta ANTHROPIC_API_KEY).',
    );
  }
  if (config.invalidModel) {
    deps.log?.(`ASSISTANT_MODEL no reconocido; se usa ${config.model}`, config.invalidModel);
  }
  if (!deps.authorization?.startsWith('Bearer ')) {
    return errorResponse(401, 'unauthorized', 'Falta la sesión del usuario.');
  }
  const messages = parseMessages(deps.body);
  if (!messages) {
    return errorResponse(400, 'invalid_request', 'La conversación no tiene una pregunta válida.');
  }

  const session = deps.createSession(deps.authorization);
  const userId = await session.getUserId();
  if (!userId) return errorResponse(401, 'unauthorized', 'La sesión no es válida.');

  try {
    const profile = await readRole(session.db, userId);
    const timezoneOffsetMinutes = parseTimezoneOffset(deps.body);
    const result = await runConversation({
      client: deps.createAnthropic({ ...config, apiKey: config.apiKey }),
      config,
      system: buildSystem(deps.guide, {
        fullName: profile.fullName,
        role: profile.role,
        now: deps.now,
        timezoneOffsetMinutes,
      }),
      tools: TOOL_DEFINITIONS,
      messages,
      executeTool: (name, input) =>
        executeTool(name, input, {
          db: session.db,
          userId,
          role: profile.role,
          guide: deps.guide,
          timezoneOffsetMinutes,
        }),
    });
    return {
      status: 200,
      body: { text: result.text, actions: result.actions, model: result.model ?? config.model },
    };
  } catch (error) {
    deps.log?.('Falló la llamada al asistente', error);
    return mapAnthropicError(error, deps.errorClasses);
  }
}
