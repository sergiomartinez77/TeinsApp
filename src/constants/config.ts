import Constants from 'expo-constants';

export type AppEnvironment = 'development' | 'staging' | 'production';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'none';

export interface AppConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly powerSyncUrl: string;
  readonly environment: AppEnvironment;
  readonly logLevel: LogLevel;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
}

type RawExtra = Readonly<Record<string, unknown>>;

const ENVIRONMENTS: readonly AppEnvironment[] = ['development', 'staging', 'production'];
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warning', 'error', 'none'];

function readString(extra: RawExtra, key: string): string {
  const value = extra[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function parseEnvironment(raw: string): AppEnvironment {
  return ENVIRONMENTS.find((env) => env === raw) ?? 'development';
}

/**
 * Nivel de log: el indicado en LOG_LEVEL; si falta o no es válido,
 * `info` en producción y `debug` en el resto de ambientes.
 */
export function parseLogLevel(raw: string, environment: AppEnvironment): LogLevel {
  const explicit = LOG_LEVELS.find((level) => level === raw);
  if (explicit) return explicit;
  return environment === 'production' ? 'info' : 'debug';
}

/** Construye la configuración a partir de `extra` de app.config.ts. */
export function buildConfig(extra: RawExtra): AppConfig {
  const environment = parseEnvironment(readString(extra, 'appEnv'));
  return {
    supabaseUrl: readString(extra, 'supabaseUrl'),
    supabaseAnonKey: readString(extra, 'supabaseAnonKey'),
    powerSyncUrl: readString(extra, 'powerSyncUrl'),
    environment,
    logLevel: parseLogLevel(readString(extra, 'logLevel'), environment),
    isProduction: environment === 'production',
    isDevelopment: environment === 'development',
  };
}

/** Nombres de las variables obligatorias que faltan (vacío si todo está bien). */
export function missingConfigKeys(config: AppConfig): string[] {
  const missing: string[] = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!config.powerSyncUrl) missing.push('POWERSYNC_URL');
  return missing;
}

export const appConfig: AppConfig = buildConfig((Constants.expoConfig?.extra ?? {}) as RawExtra);
