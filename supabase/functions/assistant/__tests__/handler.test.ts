import { DEFAULT_MODEL, FALLBACK_BETA, MAX_TOOL_ITERATIONS, readConfig } from '../config.ts';
import { mapAnthropicError } from '../errors.ts';
import guide from '../guide.json';
import {
  handleAssistantRequest,
  MAX_TURN_CHARS,
  MAX_TURNS,
  parseMessages,
  parseTimezoneOffset,
  type HandlerDeps,
} from '../handler.ts';
import {
  echoableContent,
  finalText,
  LOOP_MESSAGES,
  runConversation,
  type ToolExecutor,
} from '../loop.ts';
import { buildContextPrompt, buildStablePrompt, buildSystem, formatLocalNow } from '../prompt.ts';
import { TOOL_DEFINITIONS, type ToolOutcome } from '../tools.ts';
import type { ApiBlock } from '../types.ts';

import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  ERROR_CLASSES,
  eqValue,
  fakeAnthropic,
  fakeDb,
  message,
  PermissionDeniedError,
  RateLimitError,
  text,
  toolUse,
} from './fakes.ts';

/**
 * Función `assistant` sin Deno ni red: Anthropic y Supabase simulados.
 * Se comprueban la configuración, el bucle de herramientas, los rechazos, los
 * errores y la acción share_pdf que vuelve a la app.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const VISIT = 'aaaaaaaa-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-22T20:00:00.000Z');

const env =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];

function database() {
  return fakeDb((table, calls) => {
    if (table === 'profiles') return [{ role: 'technician', full_name: 'Ana Pérez' }];
    if (table === 'visits' && eqValue(calls, 'id') === VISIT) {
      return [{ id: VISIT, title: 'Revisión', client_name: 'Clínica Sur', technician_id: USER }];
    }
    if (table === 'visits') {
      return [
        {
          id: VISIT,
          title: 'Revisión',
          client_name: 'Clínica Sur',
          status: 'completed',
          technician_id: USER,
        },
      ];
    }
    return [];
  });
}

function deps(
  overrides: Partial<HandlerDeps> = {},
  responses = [message('end_turn', [text('Hola')])],
) {
  const anthropic = fakeAnthropic(responses);
  const db = database();
  const getUserId = jest.fn(async () => USER);
  const createSession = jest.fn(() => ({ db, getUserId }));
  const createAnthropic = jest.fn(() => anthropic);
  const value: HandlerDeps = {
    env: env({ ANTHROPIC_API_KEY: 'sk-test' }),
    authorization: 'Bearer jwt',
    body: {
      messages: [{ role: 'user', content: '¿Qué tengo que comprar?' }],
      timezoneOffsetMinutes: 300,
    },
    now: NOW,
    guide,
    createSession,
    createAnthropic,
    errorClasses: ERROR_CLASSES,
    log: jest.fn(),
    ...overrides,
  };
  return { value, anthropic, db, createSession, createAnthropic, getUserId };
}

describe('configuración', () => {
  it('modelo por defecto Haiku 5.5, sin reintento en el servidor', () => {
    expect(readConfig(env({}))).toEqual({
      apiKey: null,
      model: DEFAULT_MODEL,
      effort: 'low',
      maxTokens: 4096,
      useFallbacks: false,
      invalidModel: null,
    });
    expect(DEFAULT_MODEL).toBe('claude-haiku-5-5');
  });

  it('Opus y Sonnet 5.5 con reintento; valores no válidos', () => {
    expect(
      readConfig(env({ ASSISTANT_MODEL: 'claude-opus-5-5', ASSISTANT_EFFORT: 'medium' })),
    ).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'medium',
      useFallbacks: true,
    });
    expect(readConfig(env({ ASSISTANT_MODEL: 'claude-sonnet-5-5' })).useFallbacks).toBe(true);
    expect(
      readConfig(
        env({ ASSISTANT_MODEL: 'gpt-9', ASSISTANT_EFFORT: 'max', ANTHROPIC_API_KEY: '  ' }),
      ),
    ).toMatchObject({
      apiKey: null,
      model: DEFAULT_MODEL,
      effort: 'low',
      invalidModel: 'gpt-9',
    });
  });
});

describe('petición', () => {
  it('sin ANTHROPIC_API_KEY → 503 not_configured (sin consultar nada)', async () => {
    const { value, createSession } = deps({ env: env({}) });
    expect(await handleAssistantRequest(value)).toEqual({
      status: 503,
      body: { code: 'not_configured', message: expect.any(String) },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('sin sesión, sesión no válida o conversación vacía', async () => {
    expect((await handleAssistantRequest(deps({ authorization: null }).value)).status).toBe(401);
    const invalid = deps();
    invalid.getUserId.mockResolvedValueOnce(null as never);
    expect((await handleAssistantRequest(invalid.value)).body).toMatchObject({
      code: 'unauthorized',
    });
    expect(
      (await handleAssistantRequest(deps({ body: { messages: [] } }).value)).body,
    ).toMatchObject({
      code: 'invalid_request',
    });
  });

  it('historial: últimos turnos, recortados, empieza y termina en el usuario', () => {
    const many = Array.from({ length: 31 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `t${index} ${'x'.repeat(index === 30 ? 5000 : 1)}`,
    }));
    const parsed = parseMessages({ messages: [...many, { role: 'system', content: 'x' }, 5] });
    expect(parsed).toHaveLength(MAX_TURNS - 1);
    expect(parsed?.[0]?.role).toBe('user');
    expect(String(parsed?.at(-1)?.content)).toHaveLength(MAX_TURN_CHARS);
    expect(
      parseMessages({
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
      }),
    ).toBeNull();
    expect(parseMessages(null)).toBeNull();
    expect(parseTimezoneOffset({ timezoneOffsetMinutes: 5000 })).toBe(840);
    expect(parseTimezoneOffset({ timezoneOffsetMinutes: 'x' })).toBe(0);
  });

  it('ciclo completo con herramientas y acción share_pdf (Haiku: API estable)', async () => {
    const { value, anthropic, createAnthropic } = deps({}, [
      message('tool_use', [
        { type: 'thinking', thinking: '', signature: 'sig' },
        toolUse('t1', 'buscar_visitas', { busqueda: 'clinica' }),
        toolUse('t2', 'guia_uso', { tema: 'pdf' }),
      ]),
      message('tool_use', [toolUse('t3', 'generar_pdf_visita', { visit_id: VISIT })]),
      message('end_turn', [text('Toca «Compartir PDF» para enviar el informe de Clínica Sur.')]),
    ]);
    const response = await handleAssistantRequest(value);
    expect(response).toEqual({
      status: 200,
      body: {
        text: 'Toca «Compartir PDF» para enviar el informe de Clínica Sur.',
        actions: [{ type: 'share_pdf', visitId: VISIT, label: 'Clínica Sur — Revisión' }],
        model: 'claude-haiku-5-5',
      },
    });
    expect(createAnthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-test' }));
    expect(anthropic.betaCreate).not.toHaveBeenCalled();
    expect(anthropic.next).toHaveBeenCalledTimes(3);

    const first = anthropic.next.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(first).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 4096,
      output_config: { effort: 'low' },
      tools: TOOL_DEFINITIONS,
    });
    // Sin temperatura, sin tool_choice forzado, sin presupuesto de razonamiento ni reintento.
    for (const key of ['temperature', 'top_p', 'tool_choice', 'thinking', 'fallbacks', 'betas']) {
      expect(first).not.toHaveProperty(key);
    }
    const system = first.system as ApiBlock[];
    expect(system[0]).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(String(system[1]?.text)).toContain('Ana Pérez, rol técnico de campo');

    // La segunda llamada devuelve el contenido (con el razonamiento) y los dos resultados.
    const second = anthropic.next.mock.calls[1]?.[0] as {
      messages: { role: string; content: unknown }[];
    };
    expect(second.messages).toHaveLength(3);
    expect((second.messages[1]?.content as ApiBlock[])[0]?.type).toBe('thinking');
    const results = second.messages[2]?.content as ApiBlock[];
    expect(results.map((block) => [block.type, block.tool_use_id])).toEqual([
      ['tool_result', 't1'],
      ['tool_result', 't2'],
    ]);
  });

  it('Opus 5.5: API beta con fallbacks "default"', async () => {
    const { value, anthropic } = deps({
      env: env({ ANTHROPIC_API_KEY: 'k', ASSISTANT_MODEL: 'claude-opus-5-5' }),
    });
    await handleAssistantRequest(value);
    const params = anthropic.betaCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });
  });

  it.each([
    [new RateLimitError(429), 429, 'rate_limited'],
    [new AuthenticationError(401), 503, 'ai_auth'],
    [new PermissionDeniedError(403), 503, 'ai_auth'],
    [new APIConnectionError(), 502, 'ai_unavailable'],
    [new BadRequestError(400), 502, 'ai_error'],
    [new APIError(529), 503, 'overloaded'],
    [new APIError(500), 502, 'ai_unavailable'],
    [new Error('otro'), 500, 'internal'],
  ])('error de Anthropic %p → %i %s', async (error, status, code) => {
    expect(mapAnthropicError(error, ERROR_CLASSES)).toMatchObject({ status, body: { code } });
    const { value, anthropic } = deps();
    anthropic.next.mockRejectedValueOnce(error);
    expect(await handleAssistantRequest(value)).toMatchObject({ status, body: { code } });
  });

  it('modelo no reconocido: lo registra y usa el de defecto', async () => {
    const { value } = deps({ env: env({ ANTHROPIC_API_KEY: 'k', ASSISTANT_MODEL: 'x' }) });
    await handleAssistantRequest(value);
    expect(value.log).toHaveBeenCalledWith(expect.stringContaining('ASSISTANT_MODEL'), 'x');
  });
});

describe('bucle de herramientas', () => {
  const config = readConfig(env({ ANTHROPIC_API_KEY: 'k' }));
  const run = (
    responses: ReturnType<typeof message>[],
    executeTool: ToolExecutor = jest.fn(async (): Promise<ToolOutcome> => ({
      content: '{}',
      isError: false,
    })),
  ) => {
    const client = fakeAnthropic(responses);
    return {
      client,
      executeTool,
      result: runConversation({
        client,
        config,
        system: [],
        tools: [],
        messages: [{ role: 'user', content: 'hola' }],
        executeTool,
        maxIterations: 3,
      }),
    };
  };

  it('rechazo: no ejecuta herramientas y responde un texto honesto', async () => {
    const { result, executeTool } = run([
      message('refusal', [toolUse('t1', 'consultar_stock', {})], {
        stop_details: { category: 'cyber' },
      }),
    ]);
    expect(await result).toMatchObject({ text: LOOP_MESSAGES.refusal, stopReason: 'refusal' });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('max_tokens: no ejecuta la herramienta cortada; avisa', async () => {
    const cut = run([
      message('max_tokens', [text('Parcial'), toolUse('t1', 'consultar_stock', {})]),
    ]);
    expect((await cut.result).text).toBe(`Parcial\n\n${LOOP_MESSAGES.truncated}`);
    expect(cut.executeTool).not.toHaveBeenCalled();
    expect((await run([message('max_tokens', [])]).result).text).toBe(LOOP_MESSAGES.truncated);
  });

  it('pause_turn continúa; demasiadas vueltas; tool_use sin herramientas; vacío', async () => {
    const paused = run([message('pause_turn', [text('…')]), message('end_turn', [text('Listo')])]);
    expect(await paused.result).toMatchObject({ text: 'Listo', iterations: 2 });
    const loop = run(
      Array.from({ length: 3 }, (_, index) =>
        message('tool_use', [toolUse(`t${index}`, 'guia_uso', {})]),
      ),
    );
    expect(await loop.result).toMatchObject({
      text: LOOP_MESSAGES.tooManySteps,
      stopReason: 'max_iterations',
    });
    expect(loop.executeTool).toHaveBeenCalledTimes(3);
    expect((await run([message('tool_use', [text('raro')])]).result).text).toBe('raro');
    expect((await run([message('end_turn', [])]).result).text).toBe(LOOP_MESSAGES.empty);
    expect(MAX_TOOL_ITERATIONS).toBe(6);
  });

  it('errores de herramienta van con is_error y las acciones no se repiten', async () => {
    const action = { type: 'share_pdf' as const, visitId: 'v1', label: 'V' };
    const { result, client } = run(
      [
        message('tool_use', [
          toolUse('a', 'generar_pdf_visita', {}),
          toolUse('b', 'generar_pdf_visita', {}),
        ]),
        message('end_turn', [text('ok')]),
      ],
      jest.fn(async (name: string) =>
        name === 'generar_pdf_visita'
          ? { content: '{}', isError: false, action }
          : { content: '{}', isError: true },
      ),
    );
    expect((await result).actions).toEqual([action]);
    expect(client.next).toHaveBeenCalledTimes(2);
    const errors = run(
      [message('tool_use', [toolUse('a', 'x', {})]), message('end_turn', [text('ok')])],
      jest.fn(async () => ({ content: 'e', isError: true })),
    );
    await errors.result;
    const sent = errors.client.next.mock.calls[1]?.[0] as { messages: { content: ApiBlock[] }[] };
    expect(sent.messages[2]?.content[0]).toMatchObject({ is_error: true, tool_use_id: 'a' });
  });

  it('reintento en otro modelo: se devuelve solo lo posterior al bloque fallback', () => {
    const content: ApiBlock[] = [
      { type: 'thinking', thinking: '', signature: 's' },
      text('parcial'),
      toolUse('old', 'guia_uso', {}),
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
      { type: 'thinking', thinking: '', signature: 's2' },
      text('final'),
    ];
    expect(echoableContent(content).map((block) => block.type)).toEqual([
      'text',
      'fallback',
      'thinking',
      'text',
    ]);
    expect(finalText(content)).toBe('final');
    expect(echoableContent([text('a')])).toEqual([text('a')]);
  });
});

describe('instrucciones', () => {
  it('bloque estable sin fecha (caché) y bloque de contexto con la hora local', () => {
    const stable = buildStablePrompt(guide);
    expect(stable).toContain('- pdf: Informe PDF de la visita');
    expect(stable).toContain('Nunca inventes');
    expect(stable).not.toMatch(/2026/);
    expect(formatLocalNow(NOW, 300)).toBe('2026-11-22 15:00 (UTC−05:00)');
    expect(formatLocalNow(NOW, -330)).toBe('2026-11-23 01:30 (UTC+05:30)');
    expect(
      buildContextPrompt({ fullName: null, role: 'admin', now: NOW, timezoneOffsetMinutes: 300 }),
    ).toBe(
      'Fecha y hora local del usuario: domingo 2026-11-22 15:00 (UTC−05:00).\nUsuario: rol administración.',
    );
    expect(
      buildContextPrompt({ fullName: null, role: 'otro', now: NOW, timezoneOffsetMinutes: 0 }),
    ).toContain('rol otro');
    const system = buildSystem(guide, {
      fullName: 'A',
      role: 'office',
      now: NOW,
      timezoneOffsetMinutes: 0,
    });
    expect(system).toHaveLength(2);
    expect(system[1]).not.toHaveProperty('cache_control');
  });
});
