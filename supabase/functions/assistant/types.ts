/**
 * Tipos mínimos que usan los módulos puros de la función. Se declaran aquí
 * (y no con los tipos del SDK) porque estos módulos se compilan y prueban con
 * el `tsc` y el jest de la app, donde el SDK de Anthropic no está instalado:
 * en Deno, `index.ts` pasa los clientes reales, que cumplen estas formas.
 */

// ── Guía (copia generada en guide.json) ──────────────────────────────────────

export type GuideRole = 'technician' | 'office' | 'admin';

export interface GuideTopicJson {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly keywords: readonly string[];
  readonly steps: readonly string[];
  readonly notes?: readonly string[];
  readonly roles?: Readonly<Partial<Record<GuideRole, string>>>;
}

export interface GuideJson {
  readonly topics: readonly GuideTopicJson[];
}

// ── Supabase (PostgREST con el token del usuario: aplica la RLS) ──────────────

export interface PgResult {
  data: unknown;
  error: { message: string } | null;
}

/** Consulta encadenable de supabase-js (solo los métodos que se usan). */
export interface PgQuery extends PromiseLike<PgResult> {
  eq: (column: string, value: unknown) => PgQuery;
  in: (column: string, values: readonly unknown[]) => PgQuery;
  or: (filters: string) => PgQuery;
  order: (column: string, options?: { ascending?: boolean }) => PgQuery;
  limit: (count: number) => PgQuery;
  maybeSingle: () => PromiseLike<PgResult>;
}

export interface DbLike {
  from: (table: string) => { select: (columns: string) => PgQuery };
}

// ── Anthropic (Messages API) ─────────────────────────────────────────────────

export interface ApiBlock {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface ApiMessage {
  readonly content: readonly ApiBlock[];
  readonly stop_reason: string | null;
  readonly stop_details?: { readonly category?: string | null } | null;
  readonly model?: string;
}

export interface MessagesApi {
  create: (params: Record<string, unknown>) => Promise<ApiMessage>;
}

/** `messages.create` (Haiku) y `beta.messages.create` (con reintento en otro modelo). */
export interface AnthropicLike {
  readonly messages: MessagesApi;
  readonly beta: { readonly messages: MessagesApi };
}

export interface ApiMessageParam {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly ApiBlock[];
}

/** Acción que la app ejecuta en el teléfono. */
export interface SharePdfAction {
  readonly type: 'share_pdf';
  readonly visitId: string;
  readonly label: string;
}
