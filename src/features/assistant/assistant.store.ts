import { create } from 'zustand';

import { useAuthStore, type AuthState } from '@/store/auth.store';

import type { AssistantAction, AssistantEngineKind, AssistantTurn } from './services/engine';

/**
 * Conversación del asistente: solo en memoria (no se guarda ni se sincroniza)
 * y se borra al cerrar sesión o cambiar de usuario o de modo.
 */

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly actions: readonly AssistantAction[];
  /** Motor que respondió (solo en mensajes del asistente). */
  readonly engine?: AssistantEngineKind;
  /** Aviso sobre el motor usado ("Respondiendo sin conexión…"). */
  readonly notice?: string | null;
}

export interface AssistantState {
  messages: readonly ChatMessage[];
  isSending: boolean;
  /** La función remota respondió `not_configured`: no se vuelve a intentar en la sesión. */
  remoteDisabled: boolean;
  addMessage: (message: Omit<ChatMessage, 'id'>) => void;
  setSending: (isSending: boolean) => void;
  disableRemote: () => void;
  reset: () => void;
}

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `m${sequence}`;
};

const INITIAL = { messages: [], isSending: false, remoteDisabled: false } as const;

export const useAssistantStore = create<AssistantState>((set) => ({
  ...INITIAL,
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, { ...message, id: nextId() }] })),
  setSending: (isSending) => set({ isSending }),
  disableRemote: () => set({ remoteDisabled: true }),
  reset: () => set({ ...INITIAL }),
}));

/** Turnos de texto para el motor (sin acciones ni avisos). */
export function toTurns(messages: readonly ChatMessage[]): AssistantTurn[] {
  return messages.map((message) => ({ role: message.role, content: message.text }));
}

function sessionKey(state: Pick<AuthState, 'status' | 'user' | 'isDemoMode'>): string | null {
  if (state.status !== 'authenticated' || !state.user) return null;
  return `${state.user.id}:${state.isDemoMode ? 'demo' : 'main'}`;
}

/**
 * Borra la conversación cada vez que cambia la sesión (cierre, otro usuario,
 * modo demo). Devuelve la función para dejar de escuchar.
 */
export function clearAssistantOnSessionChange(): () => void {
  let current = sessionKey(useAuthStore.getState());
  return useAuthStore.subscribe((state) => {
    const next = sessionKey(state);
    if (next === current) return;
    current = next;
    useAssistantStore.getState().reset();
  });
}
