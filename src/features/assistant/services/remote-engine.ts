import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import type { AssistantAction, AssistantEngine, AssistantReply, AssistantTurn } from './engine';

/**
 * Motor con Claude: llama a la función `assistant` de Supabase con el cliente
 * de la app (lleva el token de la sesión, así la función consulta con la RLS
 * del usuario). La app no sabe qué modelo responde: se elige en el servidor
 * (secreto ASSISTANT_MODEL), por eso cambiar de modelo no requiere otra versión.
 */

export const ASSISTANT_FUNCTION_NAME = 'assistant';
/** Turnos del historial que se envían (incluida la pregunta actual). */
export const MAX_HISTORY_TURNS = 12;
/** Máximo de caracteres de cada turno enviado. */
export const MAX_TURN_CHARS = 2000;
/** Tiempo máximo de espera de la función. */
export const REMOTE_TIMEOUT_MS = 45_000;

export type RemoteErrorCode =
  /** La función no está desplegada o no tiene ANTHROPIC_API_KEY. */
  | 'not_configured'
  /** Sin red o la petición no llegó. */
  | 'network'
  /** El servidor no aceptó la sesión. */
  | 'unauthorized'
  /** Demasiadas consultas a la IA en poco tiempo. */
  | 'rate_limited'
  /** Cualquier otro fallo del servidor o de la IA. */
  | 'unavailable';

export class RemoteAssistantError extends Error {
  constructor(readonly code: RemoteErrorCode) {
    super(`assistant:${code}`);
    this.name = 'RemoteAssistantError';
  }
}

/** Subconjunto de `supabase.functions` que se usa (inyectable en los tests). */
export interface FunctionsInvoker {
  invoke: (
    name: string,
    options: { body: Record<string, unknown>; timeout?: number },
  ) => Promise<{ data: unknown; error: unknown }>;
}

export interface RemoteRequestBody {
  messages: AssistantTurn[];
  /** Minutos que hay que sumar a la hora local para obtener UTC (`Date#getTimezoneOffset`). */
  timezoneOffsetMinutes: number;
  [key: string]: unknown;
}

const truncate = (text: string) =>
  text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS - 1)}…` : text;

/** Cuerpo de la petición: últimos turnos, cada uno recortado, terminando en la pregunta. */
export function buildRemoteRequest(
  history: readonly AssistantTurn[],
  userMessage: string,
  now: Date,
): RemoteRequestBody {
  const turns = [...history, { role: 'user' as const, content: userMessage }]
    .filter((turn) => turn.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: truncate(turn.content) }));
  // La conversación que recibe Claude debe empezar con una pregunta del usuario.
  while (turns.length > 0 && turns[0]?.role !== 'user') turns.shift();
  return { messages: turns, timezoneOffsetMinutes: now.getTimezoneOffset() };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Solo se aceptan las acciones conocidas y bien formadas que puede devolver el servidor. */
function parseAction(value: unknown): AssistantAction | null {
  if (!isRecord(value)) return null;
  if (value.type === 'share_pdf' && typeof value.visitId === 'string' && value.visitId) {
    return {
      type: 'share_pdf',
      visitId: value.visitId,
      label: typeof value.label === 'string' && value.label ? value.label : 'Visita',
    };
  }
  if (value.type === 'open_inventory') return { type: 'open_inventory' };
  return null;
}

/** Respuesta de la función validada; lanza `unavailable` si no tiene la forma esperada. */
export function parseRemoteReply(data: unknown): AssistantReply {
  const body: unknown = typeof data === 'string' ? safeJson(data) : data;
  if (!isRecord(body) || typeof body.text !== 'string' || !body.text.trim()) {
    throw new RemoteAssistantError('unavailable');
  }
  const actions = Array.isArray(body.actions)
    ? body.actions.map(parseAction).filter((action): action is AssistantAction => action !== null)
    : [];
  return { text: body.text.trim(), actions, engine: 'claude' };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Lo que se usa de la respuesta HTTP que acompaña al error. */
interface ResponseLike {
  status?: unknown;
  json?: () => Promise<unknown>;
}

async function readErrorCode(response: ResponseLike | null | undefined): Promise<unknown> {
  if (typeof response?.json !== 'function') return null;
  try {
    const body = await response.json();
    return isRecord(body) ? body.code : null;
  } catch {
    return null;
  }
}

/** Traduce el error de `functions.invoke` a un código de la app. */
export async function classifyInvokeError(error: unknown): Promise<RemoteErrorCode> {
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return 'network';
  }
  if (error instanceof FunctionsHttpError) {
    const response = error.context as ResponseLike | null | undefined;
    const status = typeof response?.status === 'number' ? response.status : 0;
    const code = await readErrorCode(response);
    // 404: la función todavía no está desplegada.
    if (code === 'not_configured' || status === 404) return 'not_configured';
    if (code === 'unauthorized' || status === 401) return 'unauthorized';
    if (code === 'rate_limited' || status === 429) return 'rate_limited';
  }
  return 'unavailable';
}

export function createRemoteEngine(invoker: FunctionsInvoker): AssistantEngine {
  return {
    kind: 'claude',
    reply: async (history, userMessage, context) => {
      let result: { data: unknown; error: unknown };
      try {
        result = await invoker.invoke(ASSISTANT_FUNCTION_NAME, {
          body: buildRemoteRequest(history, userMessage, context.now),
          timeout: REMOTE_TIMEOUT_MS,
        });
      } catch {
        // Tiempo agotado o fallo del transporte.
        throw new RemoteAssistantError('network');
      }
      if (result.error) throw new RemoteAssistantError(await classifyInvokeError(result.error));
      return parseRemoteReply(result.data);
    },
  };
}
