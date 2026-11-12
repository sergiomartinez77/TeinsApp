import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuración de Expo.
 *
 * Las variables de entorno se leen de `.env` (Expo CLI lo carga automáticamente)
 * o del entorno de EAS Build, y se exponen a la app mediante `extra`.
 * Nunca se escriben credenciales en el código fuente.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TEINS',
  slug: 'teins-app',
  version: '1.0.0',
  scheme: 'teins',
  // La app soporta vertical y horizontal en teléfono y tablet.
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.teins.app',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription:
        'TEINS necesita la cámara para tomar fotografías de la visita técnica.',
      NSPhotoLibraryUsageDescription:
        'TEINS necesita acceso a tus fotos para adjuntarlas a la visita técnica.',
    },
  },
  android: {
    package: 'com.teins.app',
    adaptiveIcon: {
      backgroundColor: '#0D4F8B',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['CAMERA', 'READ_MEDIA_IMAGES', 'ACCESS_NETWORK_STATE', 'INTERNET'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    '@react-native-community/datetimepicker',
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
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
    powerSyncUrl: process.env.POWERSYNC_URL ?? '',
    appEnv: process.env.APP_ENV ?? 'development',
    logLevel: process.env.LOG_LEVEL ?? '',
  },
});
