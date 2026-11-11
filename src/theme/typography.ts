import type { TextStyle } from 'react-native';

import { colors } from './colors';

/** Escala tipográfica Material 3 con la fuente del sistema. */
export const typography = {
  displayLarge: {
    fontSize: 57,
    fontWeight: '400',
    letterSpacing: -0.25,
    color: colors.textPrimary,
  },
  displayMedium: { fontSize: 45, fontWeight: '400', color: colors.textPrimary },
  displaySmall: { fontSize: 36, fontWeight: '400', color: colors.textPrimary },
  headlineLarge: { fontSize: 32, fontWeight: '700', color: colors.textPrimary },
  headlineMedium: { fontSize: 28, fontWeight: '600', color: colors.textPrimary },
  headlineSmall: { fontSize: 24, fontWeight: '600', color: colors.textPrimary },
  titleLarge: { fontSize: 22, fontWeight: '600', color: colors.textPrimary },
  titleMedium: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.15,
    color: colors.textPrimary,
  },
  titleSmall: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
    color: colors.textPrimary,
  },
  bodyLarge: {
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: 0.15,
    color: colors.textPrimary,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: '400',
    letterSpacing: 0.25,
    color: colors.textPrimary,
  },
  bodySmall: {
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  labelLarge: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.1,
    color: colors.textPrimary,
  },
  labelMedium: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },
  labelSmall: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
