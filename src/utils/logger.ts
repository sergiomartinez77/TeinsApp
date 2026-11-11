import { appConfig, type LogLevel } from '@/constants/config';

/**
 * Logger con niveles configurables por LOG_LEVEL.
 *
 * Reglas: nunca registrar tokens, contraseñas ni datos personales.
 * Las claves sensibles conocidas se enmascaran antes de escribir.
 */

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
  none: 100,
};

const SENSITIVE_KEY =
  /(password|contrase|token|secret|authorization|apikey|api_key|anon_?key|jwt)/i;
const REDACTED = '[oculto]';
const MAX_DEPTH = 4;

/** Devuelve una copia del valor con las claves sensibles enmascaradas. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return output;
}

export function shouldLog(level: Exclude<LogLevel, 'none'>, configured: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configured];
}

type LogMethod = (message: string, context?: unknown) => void;

export interface Logger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

export function createLogger(configured: LogLevel, scope?: string): Logger {
  const prefix = scope ? `[TEINS:${scope}]` : '[TEINS]';

  const write =
    (level: Exclude<LogLevel, 'none'>, sink: (...args: unknown[]) => void): LogMethod =>
    (message, context) => {
      if (!shouldLog(level, configured)) return;
      if (context === undefined) sink(prefix, message);
      else sink(prefix, message, redact(context));
    };

  /* eslint-disable no-console */
  return {
    debug: write('debug', console.debug),
    info: write('info', console.info),
    warn: write('warning', console.warn),
    error: write('error', console.error),
  };
  /* eslint-enable no-console */
}

export const logger: Logger = createLogger(appConfig.logLevel);

/** Logger con etiqueta de módulo, p. ej. `scopedLogger('sync')`. */
export function scopedLogger(scope: string): Logger {
  return createLogger(appConfig.logLevel, scope);
}
