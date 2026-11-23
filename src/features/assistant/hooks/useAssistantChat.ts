import { usePowerSync } from '@powersync/react';
import { useCallback, useMemo } from 'react';

import { useConnectivity } from '@/hooks/useConnectivity';
import { useRequiredUser } from '@/hooks/useCurrentUser';
import { getSupabase } from '@/services/supabase/client';
import { useAuthStore } from '@/store/auth.store';
import { scopedLogger } from '@/utils/logger';

import { toTurns, useAssistantStore, type ChatMessage } from '../assistant.store';
import type { AssistantContext, AssistantEngine } from '../services/engine';
import { answerWithBestEngine, ENGINE_FAILURE_TEXT } from '../services/engine-selector';
import {
  answerVisitChoice,
  createLocalEngine,
  type AssistantDatabase,
} from '../services/local-engine';
import { createRemoteEngine } from '../services/remote-engine';

const log = scopedLogger('assistant');

/** Máximo de caracteres de una pregunta. */
export const MAX_QUESTION_LENGTH = 500;

/**
 * Función remota con Claude, o `null` en modo demo (no hay sesión real) o si
 * la app no tiene configurado Supabase.
 */
export function createDefaultRemoteEngine(isDemo: boolean): AssistantEngine | null {
  if (isDemo) return null;
  try {
    return createRemoteEngine(getSupabase().functions);
  } catch (error) {
    log.warn('Sin configuración de Supabase: solo asistente básico', error);
    return null;
  }
}

export interface AssistantChat {
  messages: readonly ChatMessage[];
  isSending: boolean;
  /** Motor que se intentará para la próxima pregunta. */
  preferredEngine: 'local' | 'claude';
  send: (text: string) => void;
  /** El usuario eligió una visita de la lista (para su PDF). */
  chooseVisit: (visitId: string, label: string) => void;
}

/** Conversación del asistente: envía preguntas al mejor motor disponible. */
export function useAssistantChat(): AssistantChat {
  const db: AssistantDatabase = usePowerSync();
  const user = useRequiredUser();
  const isDemo = useAuthStore((state) => state.isDemoMode);
  const isOnline = useConnectivity();
  const messages = useAssistantStore((state) => state.messages);
  const isSending = useAssistantStore((state) => state.isSending);
  const remoteDisabled = useAssistantStore((state) => state.remoteDisabled);

  const local = useMemo(() => createLocalEngine(db), [db]);
  const remote = useMemo(() => createDefaultRemoteEngine(isDemo), [isDemo]);

  const context = useCallback(
    (): AssistantContext => ({
      user: { id: user.id, role: user.role, fullName: user.fullName, email: user.email },
      now: new Date(),
    }),
    [user],
  );

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim().slice(0, MAX_QUESTION_LENGTH);
      const store = useAssistantStore.getState();
      if (!message || store.isSending) return;
      const history = toTurns(store.messages);
      store.addMessage({ role: 'user', text: message, actions: [] });
      store.setSending(true);
      void (async () => {
        try {
          const result = await answerWithBestEngine({
            history,
            message,
            context: context(),
            local,
            remote,
            isOnline,
            remoteDisabled: store.remoteDisabled,
          });
          if (result.disableRemote) useAssistantStore.getState().disableRemote();
          useAssistantStore.getState().addMessage({
            role: 'assistant',
            text: result.reply.text,
            actions: result.reply.actions,
            engine: result.reply.engine,
            notice: result.notice,
          });
        } catch (error) {
          log.error('El asistente no pudo responder', error);
          useAssistantStore.getState().addMessage({
            role: 'assistant',
            text: ENGINE_FAILURE_TEXT,
            actions: [],
            engine: 'local',
          });
        } finally {
          useAssistantStore.getState().setSending(false);
        }
      })();
    },
    [context, isOnline, local, remote],
  );

  const chooseVisit = useCallback(
    (visitId: string, label: string) => {
      const store = useAssistantStore.getState();
      if (store.isSending) return;
      store.addMessage({ role: 'user', text: `PDF de ${label}`, actions: [] });
      store.setSending(true);
      void answerVisitChoice(db, context(), visitId)
        .then((answer) =>
          useAssistantStore
            .getState()
            .addMessage({ role: 'assistant', ...answer, engine: 'local' }),
        )
        .finally(() => useAssistantStore.getState().setSending(false));
    },
    [context, db],
  );

  return {
    messages,
    isSending,
    preferredEngine: remote && isOnline && !remoteDisabled ? 'claude' : 'local',
    send,
    chooseVisit,
  };
}
