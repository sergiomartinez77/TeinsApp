import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { useAuthStore } from '@/store/auth.store';
import { DEMO_USER } from '@/models/user.model';

import { clearAssistantOnSessionChange, toTurns, useAssistantStore } from '../assistant.store';
import type { AssistantContext, AssistantEngine } from '../services/engine';
import {
  answerWithBestEngine,
  ENGINE_FAILURE_TEXT,
  ENGINE_NOTICES,
} from '../services/engine-selector';
import {
  ASSISTANT_FUNCTION_NAME,
  buildRemoteRequest,
  classifyInvokeError,
  createRemoteEngine,
  MAX_HISTORY_TURNS,
  MAX_TURN_CHARS,
  parseRemoteReply,
  RemoteAssistantError,
  REMOTE_TIMEOUT_MS,
  type FunctionsInvoker,
} from '../services/remote-engine';

jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date(2026, 10, 22, 15, 0, 0);
const context: AssistantContext = {
  user: { id: 'u1', role: 'technician', fullName: null, email: 'u@teins.com' },
  now: NOW,
};

const localEngine: AssistantEngine = {
  kind: 'local',
  reply: jest.fn(async () => ({ text: 'respuesta local', actions: [], engine: 'local' as const })),
};

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError({ status, json: async () => body });

function invoker(result: { data?: unknown; error?: unknown } | Error): FunctionsInvoker & {
  invoke: jest.Mock;
} {
  return {
    invoke: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return { data: result.data ?? null, error: result.error ?? null };
    }),
  };
}

const request = (
  remote: AssistantEngine | null,
  overrides: Partial<{ isOnline: boolean; remoteDisabled: boolean }> = {},
) =>
  answerWithBestEngine({
    history: [],
    message: '¿Qué tengo que comprar?',
    context,
    local: localEngine,
    remote,
    isOnline: overrides.isOnline ?? true,
    remoteDisabled: overrides.remoteDisabled ?? false,
  });

beforeEach(() => jest.clearAllMocks());

describe('motor remoto (función assistant)', () => {
  it('envía los últimos turnos recortados y valida la respuesta', async () => {
    const functions = invoker({
      data: {
        text: '  Compra 51 metro de cable.  ',
        actions: [
          { type: 'share_pdf', visitId: 'v1', label: 'Clínica — Revisión' },
          { type: 'share_pdf', visitId: '' },
          { type: 'borrar_todo' },
          { type: 'open_inventory' },
          null,
        ],
        model: 'claude-haiku-5-5',
      },
    });
    const engine = createRemoteEngine(functions);
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turno ${index}`,
    }));
    const reply = await engine.reply(history, 'x'.repeat(5000), context);

    expect(reply).toEqual({
      text: 'Compra 51 metro de cable.',
      actions: [
        { type: 'share_pdf', visitId: 'v1', label: 'Clínica — Revisión' },
        { type: 'open_inventory' },
      ],
      engine: 'claude',
    });
    const [name, options] = functions.invoke.mock.calls[0] as [
      string,
      { body: { messages: { role: string; content: string }[] }; timeout: number },
    ];
    expect(name).toBe(ASSISTANT_FUNCTION_NAME);
    expect(options.timeout).toBe(REMOTE_TIMEOUT_MS);
    const sent = options.body.messages;
    expect(sent.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS);
    expect(sent[0]?.role).toBe('user');
    expect(sent.at(-1)?.content).toHaveLength(MAX_TURN_CHARS);
  });

  it('cuerpo de la petición: empieza en el usuario e incluye el desfase horario', () => {
    const body = buildRemoteRequest(
      [
        { role: 'assistant', content: 'bienvenida' },
        { role: 'user', content: '  ' },
      ],
      'hola',
      NOW,
    );
    expect(body.messages).toEqual([{ role: 'user', content: 'hola' }]);
    expect(body.timezoneOffsetMinutes).toBe(NOW.getTimezoneOffset());
  });

  it('respuestas mal formadas', () => {
    expect(() => parseRemoteReply(null)).toThrow(RemoteAssistantError);
    expect(() => parseRemoteReply({ text: '   ' })).toThrow(RemoteAssistantError);
    expect(() => parseRemoteReply('no es json')).toThrow(RemoteAssistantError);
    expect(parseRemoteReply('{"text":"hola"}')).toEqual({
      text: 'hola',
      actions: [],
      engine: 'claude',
    });
    expect(
      parseRemoteReply({ text: 'ok', actions: [{ type: 'share_pdf', visitId: 'v' }] }).actions,
    ).toEqual([{ type: 'share_pdf', visitId: 'v', label: 'Visita' }]);
  });

  it.each([
    ['503 not_configured', httpError(503, { code: 'not_configured' }), 'not_configured'],
    ['404 función no desplegada', httpError(404, { code: 'NOT_FOUND' }), 'not_configured'],
    ['401', httpError(401, null), 'unauthorized'],
    ['429', httpError(429, { code: 'rate_limited' }), 'rate_limited'],
    ['502 ai_unavailable', httpError(502, { code: 'ai_unavailable' }), 'unavailable'],
    [
      'cuerpo ilegible',
      new FunctionsHttpError({
        status: 500,
        json: async () => {
          throw new Error('x');
        },
      }),
      'unavailable',
    ],
    ['sin respuesta', new FunctionsHttpError(undefined), 'unavailable'],
    ['red', new FunctionsFetchError(new Error('offline')), 'network'],
    ['relay', new FunctionsRelayError({}), 'network'],
    ['otro', new Error('raro'), 'unavailable'],
  ])('error %s → %s', async (_name, error, code) => {
    expect(await classifyInvokeError(error)).toBe(code);
    const engine = createRemoteEngine(invoker({ error }));
    await expect(engine.reply([], 'hola', context)).rejects.toMatchObject({ code });
  });

  it('tiempo agotado o transporte roto → network', async () => {
    const engine = createRemoteEngine(invoker(new Error('AbortError')));
    await expect(engine.reply([], 'hola', context)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('selección del motor', () => {
  const remote = (
    behavior: () => Promise<never> | ReturnType<AssistantEngine['reply']>,
  ): AssistantEngine => ({
    kind: 'claude',
    reply: jest.fn(behavior),
  });

  it('con conexión y función configurada responde Claude', async () => {
    const claude = remote(async () => ({ text: 'de Claude', actions: [], engine: 'claude' }));
    const result = await request(claude);
    expect(result).toEqual({
      reply: { text: 'de Claude', actions: [], engine: 'claude' },
      notice: null,
      disableRemote: false,
    });
    expect(localEngine.reply).not.toHaveBeenCalled();
  });

  it('sin conexión: básico y aviso, sin intentar la función', async () => {
    const claude = remote(async () => ({ text: 'x', actions: [], engine: 'claude' }));
    const result = await request(claude, { isOnline: false });
    expect(result.reply.engine).toBe('local');
    expect(result.notice).toBe(ENGINE_NOTICES.offline);
    expect(claude.reply).not.toHaveBeenCalled();
  });

  it('not_configured: básico sin aviso y se desactiva para la sesión', async () => {
    const result = await request(
      remote(async () => Promise.reject(new RemoteAssistantError('not_configured'))),
    );
    expect(result).toMatchObject({ notice: null, disableRemote: true, reply: { engine: 'local' } });
    const claude = remote(async () => ({ text: 'x', actions: [], engine: 'claude' }));
    expect((await request(claude, { remoteDisabled: true })).reply.engine).toBe('local');
    expect(claude.reply).not.toHaveBeenCalled();
    expect((await request(null)).notice).toBeNull();
  });

  it.each([
    ['network', ENGINE_NOTICES.offline],
    ['rate_limited', ENGINE_NOTICES.rateLimited],
    ['unauthorized', ENGINE_NOTICES.unauthorized],
    ['unavailable', ENGINE_NOTICES.unavailable],
  ] as const)('fallo %s: básico con aviso', async (code, notice) => {
    const result = await request(
      remote(async () => Promise.reject(new RemoteAssistantError(code))),
    );
    expect(result).toMatchObject({
      notice,
      disableRemote: false,
      reply: { text: 'respuesta local' },
    });
  });

  it('error inesperado del remoto y del básico', async () => {
    const result = await request(remote(async () => Promise.reject(new Error('??'))));
    expect(result.notice).toBe(ENGINE_NOTICES.unavailable);
    (localEngine.reply as jest.Mock).mockRejectedValueOnce(new Error('roto'));
    expect((await request(null)).reply).toEqual({
      text: ENGINE_FAILURE_TEXT,
      actions: [],
      engine: 'local',
    });
  });
});

describe('conversación en memoria', () => {
  afterEach(() => {
    useAssistantStore.getState().reset();
    useAuthStore.setState({ status: 'unauthenticated', user: null, isDemoMode: false });
  });

  it('se borra al cambiar o cerrar la sesión', () => {
    useAuthStore.setState({ status: 'authenticated', user: DEMO_USER, isDemoMode: true });
    const stop = clearAssistantOnSessionChange();
    const store = useAssistantStore.getState();
    store.addMessage({ role: 'user', text: 'hola', actions: [] });
    store.disableRemote();
    expect(toTurns(useAssistantStore.getState().messages)).toEqual([
      { role: 'user', content: 'hola' },
    ]);

    useAuthStore.setState({ isSubmitting: true }); // misma sesión: no se borra
    expect(useAssistantStore.getState().messages).toHaveLength(1);

    useAuthStore.setState({ status: 'unauthenticated', user: null, isDemoMode: false });
    expect(useAssistantStore.getState()).toMatchObject({ messages: [], remoteDisabled: false });
    stop();
  });
});
