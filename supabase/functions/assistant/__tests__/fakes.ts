import type { AnthropicErrorClasses } from '../errors.ts';
import type { ApiBlock, ApiMessage, DbLike, PgQuery, PgResult } from '../types.ts';

/**
 * Sustitutos de los clientes de Supabase y Anthropic para probar la función
 * sin red. La base falsa registra cada consulta encadenada y responde con lo
 * que devuelva `resolve(tabla, llamadas)`.
 */

export type Row = Record<string, unknown>;

export interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface QueryLog {
  readonly table: string;
  readonly calls: Call[];
}

export type Resolver = (table: string, calls: readonly Call[]) => Row[] | PgResult;

const toResult = (value: Row[] | PgResult): PgResult =>
  Array.isArray(value) ? { data: value, error: null } : value;

export function fakeDb(resolve: Resolver): DbLike & { log: QueryLog[] } {
  const log: QueryLog[] = [];
  return {
    log,
    from: (table: string) => ({
      select: (columns: string) => {
        const calls: Call[] = [{ method: 'select', args: [columns] }];
        log.push({ table, calls });
        const chain =
          (method: string) =>
          (...args: unknown[]) => {
            calls.push({ method, args });
            return query;
          };
        const query: PgQuery = {
          eq: chain('eq'),
          in: chain('in'),
          or: chain('or'),
          order: chain('order'),
          limit: chain('limit'),
          maybeSingle: () => {
            calls.push({ method: 'maybeSingle', args: [] });
            const result = toResult(resolve(table, calls));
            const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
            return Promise.resolve({ data, error: result.error });
          },
          then: (onFulfilled, onRejected) =>
            Promise.resolve(toResult(resolve(table, calls))).then(onFulfilled, onRejected),
        };
        return query;
      },
    }),
  };
}

/** Valor de un filtro `.eq(columna, valor)` de la consulta. */
export const eqValue = (calls: readonly Call[], column: string): unknown =>
  calls.find((call) => call.method === 'eq' && call.args[0] === column)?.args[1];

export const hasCall = (calls: readonly Call[], method: string): boolean =>
  calls.some((call) => call.method === method);

export function message(
  stopReason: string | null,
  content: ApiBlock[],
  extra: Partial<ApiMessage> = {},
): ApiMessage {
  return { content, stop_reason: stopReason, model: 'claude-haiku-5-5', ...extra };
}

export const text = (value: string): ApiBlock => ({ type: 'text', text: value });
export const toolUse = (id: string, name: string, input: unknown): ApiBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});

export function fakeAnthropic(responses: ApiMessage[]) {
  const queue = [...responses];
  const next = jest.fn(async (_params: Record<string, unknown>) => {
    const response = queue.shift();
    if (!response) throw new Error('No hay más respuestas preparadas');
    return response;
  });
  const beta = jest.fn(async (params: Record<string, unknown>) => next(params));
  return {
    messages: { create: next },
    beta: { messages: { create: beta } },
    next,
    betaCreate: beta,
  };
}

// Clases de error con la misma jerarquía que el SDK.
export class APIError extends Error {
  constructor(readonly status?: number) {
    super(`api ${status ?? ''}`);
  }
}
export class APIConnectionError extends APIError {}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class RateLimitError extends APIError {}
export class BadRequestError extends APIError {}

export const ERROR_CLASSES: AnthropicErrorClasses = {
  APIError,
  APIConnectionError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  BadRequestError,
};
