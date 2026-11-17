import type { ExpoConfig } from 'expo/config';

import appConfig, {
  APP_VERSION,
  ANDROID_PERMISSIONS,
  blockedAndroidPermissions,
  buildExpoConfig,
  getAppVariant,
  missingRequiredEnv,
  resolveBuildEnvironment,
  validateBuildEnv,
  type EnvSource,
} from '../../app.config';

const FULL_ENV: EnvSource = {
  SUPABASE_URL: 'https://proyecto.supabase.co',
  SUPABASE_ANON_KEY: 'clave-anon',
  POWERSYNC_URL: 'https://instancia.powersync.journeyapps.com',
};

const BASE: ExpoConfig = { name: 'base', slug: 'base' };

function build(env: EnvSource, warn: (message: string) => void = jest.fn()): ExpoConfig {
  return buildExpoConfig(BASE, env, warn);
}

describe('resolveBuildEnvironment', () => {
  it('usa development si APP_ENV falta o está vacío', () => {
    expect(resolveBuildEnvironment(undefined)).toBe('development');
    expect(resolveBuildEnvironment('  ')).toBe('development');
  });

  it('acepta los tres ambientes (ignorando espacios)', () => {
    expect(resolveBuildEnvironment('development')).toBe('development');
    expect(resolveBuildEnvironment(' staging ')).toBe('staging');
    expect(resolveBuildEnvironment('production')).toBe('production');
  });

  it('falla con un mensaje en español ante un valor desconocido', () => {
    expect(() => resolveBuildEnvironment('prod')).toThrow(/APP_ENV="prod" no es válido/);
  });
});

describe('getAppVariant', () => {
  it('producción conserva el nombre, el identificador y el esquema originales', () => {
    expect(getAppVariant('production')).toEqual({
      environment: 'production',
      name: 'TEINS',
      androidPackage: 'com.teins.app',
      iosBundleIdentifier: 'com.teins.app',
      scheme: 'teins',
    });
  });

  it('development lleva sufijo en nombre, identificadores y esquema', () => {
    expect(getAppVariant('development')).toEqual({
      environment: 'development',
      name: 'TEINS (Dev)',
      androidPackage: 'com.teins.app.dev',
      iosBundleIdentifier: 'com.teins.app.dev',
      scheme: 'teins-dev',
    });
  });

  it('staging lleva su propio sufijo', () => {
    expect(getAppVariant('staging')).toEqual({
      environment: 'staging',
      name: 'TEINS (Staging)',
      androidPackage: 'com.teins.app.staging',
      iosBundleIdentifier: 'com.teins.app.staging',
      scheme: 'teins-staging',
    });
  });

  it('los tres ambientes pueden instalarse a la vez (identificadores distintos)', () => {
    const ids = (['development', 'staging', 'production'] as const).map(
      (env) => getAppVariant(env).androidPackage,
    );
    expect(new Set(ids).size).toBe(3);
  });
});

describe('missingRequiredEnv', () => {
  it('no devuelve nada con todas las variables', () => {
    expect(missingRequiredEnv(FULL_ENV)).toEqual([]);
  });

  it('trata como ausentes las variables vacías o con solo espacios', () => {
    expect(missingRequiredEnv({ ...FULL_ENV, SUPABASE_URL: '', POWERSYNC_URL: '   ' })).toEqual([
      'SUPABASE_URL',
      'POWERSYNC_URL',
    ]);
    expect(missingRequiredEnv({})).toEqual(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'POWERSYNC_URL']);
  });
});

describe('validateBuildEnv', () => {
  it('no avisa ni falla con todas las variables', () => {
    const warn = jest.fn();
    for (const env of ['development', 'staging', 'production'] as const) {
      expect(() => validateBuildEnv(env, FULL_ENV, warn)).not.toThrow();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('en desarrollo solo avisa, nombrando las variables que faltan', () => {
    const warn = jest.fn();
    expect(() => validateBuildEnv('development', {}, warn)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('SUPABASE_URL, SUPABASE_ANON_KEY, POWERSYNC_URL'),
    );
  });

  it.each(['staging', 'production'] as const)('en %s falla si falta una variable', (env) => {
    const warn = jest.fn();
    expect(() =>
      validateBuildEnv(env, { ...FULL_ENV, SUPABASE_ANON_KEY: undefined }, warn),
    ).toThrow(new RegExp(`APP_ENV=${env}: faltan las variables obligatorias SUPABASE_ANON_KEY`));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('blockedAndroidPermissions', () => {
  it('bloquea micrófono, galería completa, almacenamiento total y vibración', () => {
    const blocked = blockedAndroidPermissions('production');
    expect(blocked).toEqual(
      expect.arrayContaining([
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.MANAGE_EXTERNAL_STORAGE',
        'android.permission.VIBRATE',
      ]),
    );
  });

  it('bloquea SYSTEM_ALERT_WINDOW fuera de desarrollo (lo usa el menú de desarrollo)', () => {
    expect(blockedAndroidPermissions('development')).not.toContain(
      'android.permission.SYSTEM_ALERT_WINDOW',
    );
    expect(blockedAndroidPermissions('staging')).toContain(
      'android.permission.SYSTEM_ALERT_WINDOW',
    );
    expect(blockedAndroidPermissions('production')).toContain(
      'android.permission.SYSTEM_ALERT_WINDOW',
    );
  });

  it('nunca bloquea un permiso que la app pide', () => {
    const blocked = blockedAndroidPermissions('production');
    for (const permission of ANDROID_PERMISSIONS) {
      expect(blocked).not.toContain(`android.permission.${permission}`);
    }
  });
});

describe('buildExpoConfig', () => {
  it('desarrollo: variante Dev y extra con las variables', () => {
    const config = build({ ...FULL_ENV, APP_ENV: 'development', LOG_LEVEL: 'debug' });
    expect(config.name).toBe('TEINS (Dev)');
    expect(config.scheme).toBe('teins-dev');
    expect(config.android?.package).toBe('com.teins.app.dev');
    expect(config.ios?.bundleIdentifier).toBe('com.teins.app.dev');
    expect(config.extra).toEqual({
      supabaseUrl: FULL_ENV.SUPABASE_URL,
      supabaseAnonKey: FULL_ENV.SUPABASE_ANON_KEY,
      powerSyncUrl: FULL_ENV.POWERSYNC_URL,
      appEnv: 'development',
      logLevel: 'debug',
    });
  });

  it('producción: identificador original, versión única y cifrado exento', () => {
    const config = build({ ...FULL_ENV, APP_ENV: 'production' });
    expect(config.name).toBe('TEINS');
    expect(config.android?.package).toBe('com.teins.app');
    expect(config.ios?.bundleIdentifier).toBe('com.teins.app');
    expect(config.version).toBe(APP_VERSION);
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
    // El número de build lo gestiona EAS (appVersionSource remoto).
    expect(config.android?.versionCode).toBeUndefined();
    expect(config.ios?.buildNumber).toBeUndefined();
    expect(config.extra?.appEnv).toBe('production');
    expect(config.extra?.logLevel).toBe('');
  });

  it('producción sin SUPABASE_URL: falla al evaluar la configuración', () => {
    expect(() => build({ ...FULL_ENV, SUPABASE_URL: undefined, APP_ENV: 'production' })).toThrow(
      /faltan las variables obligatorias SUPABASE_URL/,
    );
  });

  it('desarrollo sin variables: genera la configuración y avisa', () => {
    const warn = jest.fn();
    const config = build({ APP_ENV: 'development' }, warn);
    expect(config.extra?.supabaseUrl).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('incluye extra.eas.projectId solo si existe EAS_PROJECT_ID', () => {
    expect(build(FULL_ENV).extra?.eas).toBeUndefined();
    expect(build({ ...FULL_ENV, EAS_PROJECT_ID: '  ' }).extra?.eas).toBeUndefined();
    expect(build({ ...FULL_ENV, EAS_PROJECT_ID: ' id-de-prueba ' }).extra?.eas).toEqual({
      projectId: 'id-de-prueba',
    });
  });

  it('conserva las rutas de icono y splash', () => {
    const config = build(FULL_ENV);
    expect(config.icon).toBe('./assets/icon.png');
    expect(config.android?.adaptiveIcon).toMatchObject({
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    });
    expect(JSON.stringify(config.plugins)).toContain('./assets/splash-icon.png');
  });

  it('declara solo los permisos necesarios y bloquea los demás', () => {
    const config = build({ ...FULL_ENV, APP_ENV: 'staging' });
    expect(config.android?.permissions).toEqual(['CAMERA', 'INTERNET', 'ACCESS_NETWORK_STATE']);
    expect(config.android?.blockedPermissions).toEqual(blockedAndroidPermissions('staging'));
  });
});

describe('exportación por defecto (la que evalúa Expo)', () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
  });

  it('lee process.env y escribe el aviso de desarrollo en stderr', () => {
    process.env = { ...original, APP_ENV: 'development', SUPABASE_URL: '' };
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const config = appConfig({
      config: BASE,
      projectRoot: '.',
      staticConfigPath: null,
      packageJsonPath: null,
    });
    expect(config.name).toBe('TEINS (Dev)');
    expect(write).toHaveBeenCalledWith(expect.stringContaining('SUPABASE_URL'));
    write.mockRestore();
  });
});
