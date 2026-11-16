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
