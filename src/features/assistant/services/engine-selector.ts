import { scopedLogger } from '@/utils/logger';

import type { AssistantContext, AssistantEngine, AssistantReply, AssistantTurn } from './engine';
import { RemoteAssistantError, type RemoteErrorCode } from './remote-engine';

/**
 * Elige el motor de cada respuesta:
 *
 * 1. Con conexión y la función configurada → Claude.
 * 2. Si la función dice `not_configured` (o no está desplegada), se recuerda
 *    durante la sesión y se usa siempre el asistente básico, sin avisos.
 * 3. Sin conexión, o si Claude falla → asistente básico, avisando al usuario.
 */

const log = scopedLogger('assistant');

export const ENGINE_NOTICES = {
  offline: 'Respondiendo sin conexión con el asistente básico.',
  rateLimited:
    'El asistente con IA está recibiendo muchas consultas. Respondo con el asistente básico.',
  unauthorized:
    'Tu sesión no fue aceptada por el asistente con IA. Respondo con el asistente básico.',
  unavailable: 'El asistente con IA no respondió. Respondo con el asistente básico.',
} as const;

export const ENGINE_FAILURE_TEXT =
  'No pude preparar la respuesta. Intenta nuevamente en un momento.';

export interface AnswerRequest {
  readonly history: readonly AssistantTurn[];
  readonly message: string;
  readonly context: AssistantContext;
  readonly local: AssistantEngine;
  /** `null` si no hay función remota (modo demo o app sin configurar). */
  readonly remote: AssistantEngine | null;
  readonly isOnline: boolean;
  /** La función ya respondió `not_configured` en esta sesión. */
  readonly remoteDisabled: boolean;
}

export interface AnswerResult {
  readonly reply: AssistantReply;
  /** Aviso para el usuario sobre el motor usado; `null` si no hace falta. */
  readonly notice: string | null;
  /** A partir de ahora no intentar la función remota (no está configurada). */
  readonly disableRemote: boolean;
}

const NOTICE_BY_CODE: Readonly<Record<Exclude<RemoteErrorCode, 'not_configured'>, string>> = {
  network: ENGINE_NOTICES.offline,
  rate_limited: ENGINE_NOTICES.rateLimited,
  unauthorized: ENGINE_NOTICES.unauthorized,
  unavailable: ENGINE_NOTICES.unavailable,
};

async function localReply(request: AnswerRequest): Promise<AssistantReply> {
  try {
    return await request.local.reply(request.history, request.message, request.context);
  } catch (error) {
    log.error('El asistente básico no pudo responder', error);
    return { text: ENGINE_FAILURE_TEXT, actions: [], engine: 'local' };
  }
}

export async function answerWithBestEngine(request: AnswerRequest): Promise<AnswerResult> {
  const { remote } = request;
  if (!remote || request.remoteDisabled) {
    return { reply: await localReply(request), notice: null, disableRemote: false };
  }
  if (!request.isOnline) {
    return {
      reply: await localReply(request),
      notice: ENGINE_NOTICES.offline,
      disableRemote: false,
    };
  }
  try {
    const reply = await remote.reply(request.history, request.message, request.context);
    return { reply, notice: null, disableRemote: false };
  } catch (error) {
    const code: RemoteErrorCode =
      error instanceof RemoteAssistantError ? error.code : 'unavailable';
    if (code === 'not_configured') {
      return { reply: await localReply(request), notice: null, disableRemote: true };
    }
    log.warn('El asistente con IA no respondió; se usa el básico', { code });
    return { reply: await localReply(request), notice: NOTICE_BY_CODE[code], disableRemote: false };
  }
}
