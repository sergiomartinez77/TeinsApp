import type { AssistantEngine } from '../engine';

import {
  answerIntent,
  answerVisitChoice,
  answerVisitMaterialsChoice,
  type AssistantDatabase,
} from './handlers';
import { detectIntent } from './intents';

/**
 * Asistente básico: gratis, sin conexión y sin IA. Interpreta la pregunta con
 * reglas (intents.ts) y responde con los datos de la base local del teléfono.
 * El historial no se usa: cada pregunta se responde por sí sola.
 */
export function createLocalEngine(db: AssistantDatabase): AssistantEngine {
  return {
    kind: 'local',
    reply: async (_history, userMessage, context) => {
      const answer = await answerIntent(db, detectIntent(userMessage), userMessage, context);
      return { ...answer, engine: 'local' };
    },
  };
}

export { answerVisitChoice, answerVisitMaterialsChoice, type AssistantDatabase };
export { detectIntent, type Intent } from './intents';
