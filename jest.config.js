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
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
    '!src/app/**',
  ],
};
