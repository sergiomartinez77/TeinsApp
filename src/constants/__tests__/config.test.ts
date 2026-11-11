import { buildConfig, missingConfigKeys, parseEnvironment, parseLogLevel } from '../config';

describe('config', () => {
  it('usa development cuando el ambiente no es válido', () => {
    expect(parseEnvironment('produccion')).toBe('development');
    expect(parseEnvironment('')).toBe('development');
    expect(parseEnvironment('staging')).toBe('staging');
  });

  it('usa info por defecto en producción y debug en el resto', () => {
    expect(parseLogLevel('', 'production')).toBe('info');
    expect(parseLogLevel('', 'development')).toBe('debug');
    expect(parseLogLevel('error', 'production')).toBe('error');
    expect(parseLogLevel('ruidoso', 'staging')).toBe('debug');
  });

  it('construye la configuración a partir de extra', () => {
    const config = buildConfig({
      supabaseUrl: ' https://demo.supabase.co ',
      supabaseAnonKey: 'anon',
      powerSyncUrl: 'https://demo.powersync.com',
      appEnv: 'production',
      logLevel: '',
    });

    expect(config.supabaseUrl).toBe('https://demo.supabase.co');
    expect(config.environment).toBe('production');
    expect(config.isProduction).toBe(true);
    expect(config.isDevelopment).toBe(false);
    expect(config.logLevel).toBe('info');
    expect(missingConfigKeys(config)).toEqual([]);
  });

  it('informa las variables obligatorias que faltan', () => {
    const config = buildConfig({ supabaseUrl: 'https://demo.supabase.co', appEnv: 42 });

    expect(config.environment).toBe('development');
    expect(missingConfigKeys(config)).toEqual(['SUPABASE_ANON_KEY', 'POWERSYNC_URL']);
  });
});
