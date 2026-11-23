import { FALLBACK_BETA, MAX_TOOL_ITERATIONS, type AssistantConfig } from './config.ts';
import type { ToolOutcome } from './tools.ts';
import type {
  AnthropicLike,
  ApiBlock,
  ApiMessage,
  ApiMessageParam,
  SharePdfAction,
} from './types.ts';

/**
 * Bucle de herramientas (manual, con la API Messages estable; con Opus 5.5 y
 * Sonnet 5.5 se usa `beta.messages` solo para el reintento del servidor en
 * otro modelo, `fallbacks: "default"`).
 *
 * - `tool_use`: se ejecutan TODAS las herramientas pedidas y se devuelven los
 *   resultados en un solo mensaje; hasta MAX_TOOL_ITERATIONS vueltas.
 * - `refusal`: no se ejecuta nada de ese turno; se responde un texto honesto.
 * - `max_tokens`: no se ejecutan herramientas con la entrada cortada; se
 *   devuelve lo que haya con un aviso.
 * - `pause_turn`: se reenvía el turno tal cual para que continúe.
 * - Sin temperatura ni prefill (Haiku 5.5 los rechaza) ni `tool_choice` forzado
 *   (Opus/Sonnet 5.5 lo rechazan); el razonamiento adaptativo queda por defecto
 *   y se regula con `effort`.
 */

export const LOOP_MESSAGES = {
  refusal:
    'No puedo ayudarte con esa solicitud. Pregúntame por el inventario, tus visitas, el consumo de materiales, el PDF de una visita o cómo usar la app.',
  truncated:
    '(La respuesta quedó incompleta. Pide un resumen más corto o una pregunta más concreta.)',
  tooManySteps:
    'No pude completar la consulta en pocos pasos. Intenta con una pregunta más concreta.',
  empty: 'No obtuve una respuesta. Intenta preguntarlo de otra forma.',
} as const;

export type ToolExecutor = (name: string, input: unknown) => Promise<ToolOutcome>;

export interface ConversationRequest {
  readonly client: AnthropicLike;
  readonly config: AssistantConfig;
  readonly system: readonly ApiBlock[];
  readonly tools: readonly unknown[];
  readonly messages: readonly ApiMessageParam[];
  readonly executeTool: ToolExecutor;
  readonly maxIterations?: number;
}

export interface ConversationResult {
  readonly text: string;
  readonly actions: readonly SharePdfAction[];
  readonly stopReason: string | null;
  /** Llamadas a la API hechas. */
  readonly iterations: number;
  /** Modelo que produjo la respuesta final (puede ser el de reintento). */
  readonly model: string | null;
}

/**
 * Contenido de la respuesta para devolverlo en el siguiente turno. Si hubo un
 * reintento en otro modelo (bloque `fallback`), se quitan los bloques de
 * razonamiento y de herramientas ANTERIORES al último `fallback`, que es lo
 * que pide la API; el bloque `fallback` se mantiene en su sitio.
 */
export function echoableContent(content: readonly ApiBlock[]): ApiBlock[] {
  let boundary = -1;
  content.forEach((block, index) => {
    if (block.type === 'fallback') boundary = index;
  });
  if (boundary < 0) return [...content];
  const kept = new Set(['text', 'fallback']);
  return content.filter((block, index) => index >= boundary || kept.has(block.type));
}

/** Texto final del modelo (los bloques de texto posteriores al último `fallback`). */
export function finalText(content: readonly ApiBlock[]): string {
  let start = 0;
  content.forEach((block, index) => {
    if (block.type === 'fallback') start = index + 1;
  });
  return content
    .slice(start)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block.text))
    .join('\n')
    .trim();
}

function callApi(request: ConversationRequest, messages: readonly ApiMessageParam[]) {
  const { config } = request;
  const params: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: request.system,
    tools: request.tools,
    // Copia: el historial sigue creciendo en el bucle.
    messages: [...messages],
    output_config: { effort: config.effort },
  };
  if (config.useFallbacks) {
    return request.client.beta.messages.create({
      ...params,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });
  }
  return request.client.messages.create(params);
}

export async function runConversation(request: ConversationRequest): Promise<ConversationResult> {
  const maxIterations = request.maxIterations ?? MAX_TOOL_ITERATIONS;
  const messages: ApiMessageParam[] = [...request.messages];
  const actions: SharePdfAction[] = [];
  let response: ApiMessage | null = null;

  const result = (text: string, stopReason: string | null, iterations: number) => ({
    text,
    actions,
    stopReason,
    iterations,
    model: response?.model ?? null,
  });

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    response = await callApi(request, messages);
    const content = response.content;
    const text = finalText(content);

    switch (response.stop_reason) {
      case 'refusal':
        // Un rechazo puede cortar un tool_use a medias: no se ejecuta nada.
        return result(LOOP_MESSAGES.refusal, 'refusal', iteration);
      case 'max_tokens':
        return result(
          text ? `${text}\n\n${LOOP_MESSAGES.truncated}` : LOOP_MESSAGES.truncated,
          'max_tokens',
          iteration,
        );
      case 'pause_turn':
        messages.push({ role: 'assistant', content: echoableContent(content) });
        continue;
      case 'tool_use': {
        const echoed = echoableContent(content);
        const calls = echoed.filter((block) => block.type === 'tool_use');
        if (calls.length === 0) return result(text || LOOP_MESSAGES.empty, 'tool_use', iteration);
        messages.push({ role: 'assistant', content: echoed });
        const results: ApiBlock[] = [];
        for (const call of calls) {
          const outcome = await request.executeTool(String(call.name), call.input);
          if (outcome.action && !actions.some((a) => a.visitId === outcome.action?.visitId)) {
            actions.push(outcome.action);
          }
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: outcome.content,
            ...(outcome.isError ? { is_error: true } : {}),
          });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      default:
        return result(text || LOOP_MESSAGES.empty, response.stop_reason, iteration);
    }
  }
  return result(LOOP_MESSAGES.tooManySteps, 'max_iterations', maxIterations);
}
