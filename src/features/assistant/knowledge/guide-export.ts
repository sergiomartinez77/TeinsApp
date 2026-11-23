import type { GuideTopic } from './guide';

/**
 * Copia de la guía para la función del servidor
 * (`supabase/functions/assistant/guide.json`).
 *
 * Sin dependencias (ni alias `@/`): la usan el script `npm run assistant:guide`
 * (Node, sin compilar) y el test que comprueba que la copia está al día.
 */

export const GUIDE_JSON_PATH = 'supabase/functions/assistant/guide.json';

export interface GuideJson {
  readonly generatedFrom: string;
  readonly topics: readonly GuideTopic[];
}

/** Contenido del JSON (mismo orden y campos que la guía). */
export function buildGuideJson(topics: readonly GuideTopic[]): GuideJson {
  return {
    generatedFrom: 'src/features/assistant/knowledge/guide.ts',
    topics: topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      keywords: [...topic.keywords],
      steps: [...topic.steps],
      ...(topic.notes ? { notes: [...topic.notes] } : {}),
      ...(topic.roles ? { roles: { ...topic.roles } } : {}),
    })),
  };
}

/** Texto exacto del archivo: JSON con 2 espacios y salto de línea final. */
export function serializeGuideJson(topics: readonly GuideTopic[]): string {
  return `${JSON.stringify(buildGuideJson(topics), null, 2)}\n`;
}
