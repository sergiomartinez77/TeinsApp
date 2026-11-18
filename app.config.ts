import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuración de Expo.
 *
 * Las variables de entorno se leen de `.env` (Expo CLI lo carga automáticamente)
 * o de las variables del entorno de EAS (EAS Build), y se exponen a la app mediante
 * `extra`. Nunca se escriben credenciales en el código fuente.
 *
 * `APP_ENV` elige la variante: nombre, identificador y esquema propios para
 * development y staging, de modo que se instalan junto a la versión de producción.
 * Ver docs/COMPILACION.md.
 *
 * IMPORTANTE: Node evalúa este archivo FUERA de Metro. No puede importar archivos
 * TypeScript propios (Node no resuelve `.ts` sin extensión), ni usar el alias `@/`,
 * ni módulos de React Native. Por eso la lógica pura vive aquí, exportada con
 * nombre para cubrirla con tests (src/__tests__/app-config.test.ts).
 */

// ── Versión ───────────────────────────────────────────────────────────────────

/**
 * Versión visible para el usuario (versionName / CFBundleShortVersionString).
 * Es la ÚNICA fuente de verdad: se sube a mano en cada publicación.
 * El número de build (android.versionCode / ios.buildNumber) NO se declara aquí:
 * lo guarda y lo incrementa EAS (`cli.appVersionSource: "remote"` en eas.json).
 */
export const APP_VERSION = '1.0.0';

// ── Variantes por ambiente ────────────────────────────────────────────────────

export type BuildEnvironment = 'development' | 'staging' | 'production';

/** Variables sin las cuales la app no tiene backend. */
export const REQUIRED_ENV_VARS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'POWERSYNC_URL'] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

/** Entorno de procesos (normalmente `process.env`). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface AppVariant {
  readonly environment: BuildEnvironment;
  /** Nombre visible bajo el icono. */
  readonly name: string;
  readonly androidPackage: string;
  readonly iosBundleIdentifier: string;
  /** Esquema de deep link (`teins://`, `teins-dev://`...). */
  readonly scheme: string;
}

const BASE_NAME = 'TEINS';
const BASE_IDENTIFIER = 'com.teins.app';
const BASE_SCHEME = 'teins';

const ENVIRONMENTS: readonly BuildEnvironment[] = ['development', 'staging', 'production'];

/**
 * Sufijos por ambiente. Producción no lleva sufijo: conserva `com.teins.app`.
 * Desarrollo y staging tienen identificador, nombre y esquema propios para poder
 * instalarse en el mismo dispositivo que producción.
 */
const VARIANT_SUFFIX: Readonly<
  Record<BuildEnvironment, { id: string; label: string; scheme: string }>
> = {
  development: { id: '.dev', label: ' (Dev)', scheme: '-dev' },
  staging: { id: '.staging', label: ' (Staging)', scheme: '-staging' },
  production: { id: '', label: '', scheme: '' },
};

/**
 * Ambiente de build a partir de `APP_ENV`. Vacío ⇒ `development`.
 * Un valor desconocido es un error: compilar "prod" como desarrollo por una
 * errata sería peor que fallar.
 */
export function resolveBuildEnvironment(raw: string | undefined): BuildEnvironment {
  const value = (raw ?? '').trim();
  if (!value) return 'development';
  const environment = ENVIRONMENTS.find((env) => env === value);
  if (!environment) {
    throw new Error(
      `[TEINS] APP_ENV="${value}" no es válido. Usa uno de: ${ENVIRONMENTS.join(', ')}.`,
    );
  }
  return environment;
}

/** Nombre, identificadores y esquema de la app para un ambiente. */
export function getAppVariant(environment: BuildEnvironment): AppVariant {
  const suffix = VARIANT_SUFFIX[environment];
  return {
    environment,
    name: `${BASE_NAME}${suffix.label}`,
    androidPackage: `${BASE_IDENTIFIER}${suffix.id}`,
    iosBundleIdentifier: `${BASE_IDENTIFIER}${suffix.id}`,
    scheme: `${BASE_SCHEME}${suffix.scheme}`,
  };
}

// ── Validación de variables ───────────────────────────────────────────────────

/** Variables obligatorias ausentes o vacías en `env`. */
export function missingRequiredEnv(env: EnvSource): RequiredEnvVar[] {
  return REQUIRED_ENV_VARS.filter((key) => !(env[key] ?? '').trim());
}

/**
 * Comprueba las variables obligatorias para el ambiente de build.
 *
 * - `staging` / `production`: si falta alguna, lanza un error (no se debe
 *   compilar ni publicar una app sin backend).
 * - `development`: solo avisa mediante `warn`; la app muestra en su arranque
 *   qué variable falta.
 */
export function validateBuildEnv(
  environment: BuildEnvironment,
  env: EnvSource,
  warn: (message: string) => void,
): void {
  const missing = missingRequiredEnv(env);
  if (missing.length === 0) return;

  const list = missing.join(', ');
  if (environment === 'development') {
    warn(
      `[TEINS] Aviso: faltan variables de entorno (${list}). ` +
        'La app arrancará sin backend. Revisa tu archivo .env (ver .env.example).',
    );
    return;
  }

  throw new Error(
    `[TEINS] No se puede generar la configuración para APP_ENV=${environment}: ` +
      `faltan las variables obligatorias ${list}. ` +
      'Defínelas en el entorno de EAS correspondiente (eas env:set) o en tu .env ' +
      'antes de compilar. Consulta docs/COMPILACION.md.',
  );
}

// ── Permisos de Android ───────────────────────────────────────────────────────

/**
 * Permisos que la app pide explícitamente:
 * - CAMERA: fotografías de la visita (expo-image-picker).
 * - INTERNET: Supabase, PowerSync y subida de fotos.
 * - ACCESS_NETWORK_STATE: detectar la conexión (NetInfo) para sincronizar.
 *
 * Las librerías añaden además, por su cuenta y con razón: ACCESS_WIFI_STATE
 * (NetInfo) y READ/WRITE_EXTERNAL_STORAGE limitados a Android ≤ 12
 * (maxSdkVersion=32), que el selector de galería pide en esas versiones.
 */
export const ANDROID_PERMISSIONS = ['CAMERA', 'INTERNET', 'ACCESS_NETWORK_STATE'];

/**
 * Permisos que añaden las librerías o la plantilla nativa y que la app no
 * necesita. Se eliminan del manifiesto final (`tools:node="remove"`).
 */
export function blockedAndroidPermissions(environment: BuildEnvironment): string[] {
  const always = [
    // Micrófono: no se graba audio ni vídeo.
    'android.permission.RECORD_AUDIO',
    // Galería completa, vídeo y audio: en Android 13+ el selector del sistema
    // (Photo Picker) no necesita permiso; en Android 7–12 bastan los permisos de
    // almacenamiento con maxSdkVersion=32 que declaran las librerías.
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_AUDIO',
    'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    'android.permission.ACCESS_MEDIA_LOCATION',
    // Acceso total al almacenamiento: nunca es necesario.
    'android.permission.MANAGE_EXTERNAL_STORAGE',
    // Vibración: la app no la usa (la plantilla de Expo la añade por defecto).
    'android.permission.VIBRATE',
  ];
  // "Mostrar sobre otras apps" solo lo usa el menú de desarrollo de React Native.
  return environment === 'development'
    ? always
    : [...always, 'android.permission.SYSTEM_ALERT_WINDOW'];
}

// ── Configuración ─────────────────────────────────────────────────────────────

const CAMERA_PERMISSION_TEXT =
  'TEINS necesita la cámara para tomar fotografías de la visita técnica.';
const PHOTOS_PERMISSION_TEXT =
  'TEINS necesita acceso a tus fotos para adjuntarlas a la visita técnica.';

/** Construye la configuración de Expo a partir de un entorno de procesos. */
/** Proyecto de EAS de TEINS en expo.dev. */
export const DEFAULT_EAS_PROJECT_ID = 'b59cb461-3e85-4ae9-847d-c7acad4a8238';

export function buildExpoConfig(
  config: ConfigContext['config'],
  env: EnvSource,
  warn: (message: string) => void,
): ExpoConfig {
  const environment = resolveBuildEnvironment(env.APP_ENV);
  const variant = getAppVariant(environment);

  // En staging/producción falla si falta el backend; en desarrollo solo avisa.
  validateBuildEnv(environment, env, warn);

  // Proyecto de EAS (lo da `eas init` / expo.dev). No es secreto: Expo recomienda
  // dejarlo en la configuración. EAS_PROJECT_ID permite usar otro proyecto.
  const easProjectId = env.EAS_PROJECT_ID?.trim() || DEFAULT_EAS_PROJECT_ID;

  return {
    ...config,
    name: variant.name,
    // Deben coincidir con el proyecto en expo.dev (@sergiomtz7s-team/teins).
    owner: 'sergiomtz7s-team',
    slug: 'teins',
    version: APP_VERSION,
    scheme: variant.scheme,
    // La app soporta vertical y horizontal en teléfono y tablet.
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: variant.iosBundleIdentifier,
      supportsTablet: true,
      config: {
        // ITSAppUsesNonExemptEncryption = false: la app solo usa el cifrado estándar
        // del sistema (HTTPS/TLS y Keychain vía expo-secure-store). Evita la pregunta
        // de cumplimiento de exportación en cada envío a App Store Connect.
        usesNonExemptEncryption: false,
      },
      // Los textos de permiso (cámara y fotos) los escribe el plugin de
      // expo-image-picker más abajo: una sola fuente, sin duplicados en infoPlist.
    },
    android: {
      package: variant.androidPackage,
      adaptiveIcon: {
        backgroundColor: '#0D4F8B',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      permissions: ANDROID_PERMISSIONS,
      blockedPermissions: blockedAndroidPermissions(environment),
    },
    plugins: [
      'expo-router',
      [
        'expo-secure-store',
        {
          // La sesión se guarda en el Keychain sin biometría: no se pide Face ID
          // (el plugin añadiría por defecto un texto de permiso en inglés).
          faceIDPermission: false,
        },
      ],
      '@react-native-community/datetimepicker',
      'expo-image',
      [
        'expo-image-picker',
        {
          cameraPermission: CAMERA_PERMISSION_TEXT,
          photosPermission: PHOTOS_PERMISSION_TEXT,
          // No se graban vídeos: no hace falta el micrófono.
          microphonePermission: false,
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 160,
          resizeMode: 'contain',
          backgroundColor: '#0D4F8B',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      supabaseUrl: env.SUPABASE_URL ?? '',
      supabaseAnonKey: env.SUPABASE_ANON_KEY ?? '',
      powerSyncUrl: env.POWERSYNC_URL ?? '',
      appEnv: environment,
      logLevel: env.LOG_LEVEL ?? '',
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    },
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  buildExpoConfig(config, process.env, (message) => {
    process.stderr.write(`${message}\n`);
  });
