import type { UserProfile } from '@/models/user.model';

/**
 * Contrato común de los dos motores del asistente:
 *
 * - `local`: asistente básico, gratis y sin conexión. Interpreta la pregunta
 *   con reglas (sin IA) y responde con los datos de la base del teléfono.
 * - `claude`: función del servidor (`supabase/functions/assistant`) con Claude.
 *   Solo se usa si hay conexión y la función está configurada.
 *
 * Los dos devuelven texto y acciones que la app ejecuta (compartir el PDF,
 * abrir el inventario…). Ninguno inventa datos: todo sale de la base o de la
 * guía de uso (`knowledge/guide.ts`).
 */

export type AssistantEngineKind = 'local' | 'claude';

/** Acción que acompaña a una respuesta y la app ejecuta al tocarla. */
export type AssistantAction =
  /** Generar el PDF de la visita en el teléfono y abrir la hoja de compartir. */
  | { readonly type: 'share_pdf'; readonly visitId: string; readonly label: string }
  /** Ir a la pantalla de inventario. */
  | { readonly type: 'open_inventory' }
  /** Elegir una visita cuando la búsqueda dio varias (pide su PDF). */
  | { readonly type: 'select_visit'; readonly visitId: string; readonly label: string }
  /** Sugerencia: al tocarla se envía `message` como si el usuario lo escribiera. */
  | { readonly type: 'suggestion'; readonly label: string; readonly message: string };

export interface AssistantReply {
  readonly text: string;
  readonly actions: readonly AssistantAction[];
  readonly engine: AssistantEngineKind;
}

/** Turno anterior de la conversación (solo texto). */
export interface AssistantTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AssistantContext {
  readonly user: Pick<UserProfile, 'id' | 'role' | 'fullName' | 'email'>;
  /** Fecha y hora "actual" (inyectable en los tests). */
  readonly now: Date;
}

export interface AssistantEngine {
  readonly kind: AssistantEngineKind;
  reply: (
    history: readonly AssistantTurn[],
    userMessage: string,
    context: AssistantContext,
  ) => Promise<AssistantReply>;
}

/** Sugerencia lista para usar como acción. */
export const suggestion = (label: string, message: string = label): AssistantAction => ({
  type: 'suggestion',
  label,
  message,
});

/** Sugerencias de arranque y de "no entendí". */
export const DEFAULT_SUGGESTIONS: readonly AssistantAction[] = [
  suggestion('¿Qué tengo que comprar?'),
  suggestion('¿Cuánto stock hay?', '¿Cuánto stock hay en bodega?'),
  suggestion('Visitas pendientes', '¿Qué visitas tengo pendientes?'),
  suggestion('Consumo de este mes', '¿Cuánto material se consumió este mes?'),
  suggestion('PDF de una visita', 'Quiero el PDF de una visita'),
  suggestion('¿Cómo uso la app?', '¿Cómo uso la app?'),
];

/** Primer mensaje que se muestra en el chat. */
export const ASSISTANT_WELCOME =
  'Hola, soy el asistente de TEINS. Pregúntame por existencias, qué comprar, consumo de materiales, tus visitas, el PDF de una visita o cómo usar la app.';
