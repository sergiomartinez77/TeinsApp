import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

// ── Módulos nativos de fotografías ───────────────────────────────────────────
// expo-file-system ya lo simula jest-expo con un sistema de archivos en memoria.

jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: View };
});

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

// Ubicación: por defecto sin permiso (la foto se guarda con "Ubicación no disponible").
jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    granted: false,
    status: 'denied',
    canAskAgain: true,
    expires: 'never',
  })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  getCurrentPositionAsync: jest.fn(async () => {
    throw new Error('Ubicación no disponible en los tests');
  }),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  ImageManipulator: {
    manipulate: jest.fn(() => {
      throw new Error('ImageManipulator no está disponible en los tests');
    }),
  },
}));

// ── Skia ─────────────────────────────────────────────────────────────────────
// Simulador oficial de la librería (dibuja con CanvasKit). Solo funciona en los
// archivos que usan `@jest-environment ./jest.skia-environment.js`.

jest.mock('@shopify/react-native-skia', () => {
  const canvasKit: unknown = Reflect.get(globalThis, 'CanvasKit');
  if (!canvasKit) {
    throw new Error(
      'Skia necesita el entorno de tests "./jest.skia-environment.js" (comentario @jest-environment).',
    );
  }
  const { Mock } = jest.requireActual<{ Mock: (kit: unknown) => unknown }>(
    '@shopify/react-native-skia/lib/commonjs/mock',
  );
  return Mock(canvasKit);
});

// ── Informe PDF ──────────────────────────────────────────────────────────────
// expo-print y expo-sharing son módulos nativos. El PDF "impreso" es un archivo
// del sistema de archivos en memoria de jest-expo con el HTML recibido, para
// poder moverlo y revisarlo en los tests.

jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(async (options: { html?: string } = {}) => {
    const { File, Paths } =
      jest.requireActual<typeof import('expo-file-system')>('expo-file-system');
    const file = new File(Paths.cache, `Print-${Date.now()}.pdf`);
    file.write(options.html ?? '');
    return { uri: file.uri, numberOfPages: 1 };
  }),
  printAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
