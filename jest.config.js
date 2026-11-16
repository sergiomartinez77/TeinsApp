/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Simulación oficial del módulo nativo de gestos (GestureDetector en los tests).
  setupFiles: ['react-native-gesture-handler/jestSetup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // El paquete nativo reexporta @powersync/common; en tests se usa la parte pura.
    '^@powersync/react-native$': '@powersync/common',
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)'],
  // Con la instrumentación de cobertura, el primer test de los archivos que
  // montan componentes tarda más de los 5 s por defecto (carga en frío de
  // React Native y transformación de módulos). 20 s deja margen sin ocultar cuelgues.
  testTimeout: 20000,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    // Utilidades de test (base SQLite, sustitutos): no son código de la app.
    '!src/test-utils/**',
    '!src/**/*.d.ts',
    '!src/app/**',
  ],
  // Umbrales mínimos. Con un patrón (glob), Jest aplica el umbral a CADA archivo
  // que coincide: la lógica crítica no puede quedarse atrás ni en un solo archivo.
  coverageThreshold: {
    global: { lines: 85, branches: 80 },
    './src/**/services/**': { lines: 90 },
    './src/store/**': { lines: 90 },
    './src/models/**': { lines: 90 },
  },
};
