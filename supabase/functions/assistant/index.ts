// Función Edge «assistant» (Deno, Supabase). Solo conecta la lógica de
// handler.ts con Deno.serve, Supabase y el SDK de Anthropic; todo lo demás
// está en módulos puros probados con jest (supabase/functions/assistant/__tests__).
//
// Desplegar (verify_jwt queda activo: solo usuarios con sesión):
//   npx supabase functions deploy assistant
// Activar Claude: secretos ANTHROPIC_API_KEY y ASSISTANT_MODEL (docs/BACKEND.md).

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

import guide from './guide.json' with { type: 'json' };
import { handleAssistantRequest, type UserSession } from './handler.ts';
import type { AnthropicLike, DbLike } from './types.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function createSession(authorization: string): UserSession {
  // Cliente con la clave pública y el token del usuario: todas las consultas
  // pasan por la RLS (admin y oficina ven más; el técnico, lo suyo).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const token = authorization.replace(/^Bearer\s+/i, '');
  return {
    db: supabase as unknown as DbLike,
    getUserId: async () => {
      const { data, error } = await supabase.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') {
    return json({ code: 'method_not_allowed', message: 'Usa POST.' }, 405);
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await handleAssistantRequest({
    env: (name) => Deno.env.get(name),
    authorization: request.headers.get('Authorization'),
    body,
    now: new Date(),
    guide,
    createSession,
    createAnthropic: (config) =>
      new Anthropic({ apiKey: config.apiKey, maxRetries: 2 }) as unknown as AnthropicLike,
    errorClasses: Anthropic,
    log: (message, detail) => console.error(`[assistant] ${message}`, detail ?? ''),
  });
  return json(result.body, result.status);
});
