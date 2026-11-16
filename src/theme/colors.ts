/**
 * Paleta corporativa TEINS.
 * Valores idénticos a los de la app original: son la identidad visual.
 */
export const colors = {
  // Primarios
  primary: '#0D4F8B',
  primaryLight: '#2E72B8',
  primaryDark: '#08305A',
  onPrimary: '#FFFFFF',

  // Secundarios
  secondary: '#00A878',
  secondaryLight: '#33C49A',
  secondaryDark: '#007A57',
  onSecondary: '#FFFFFF',

  // Neutros
  surface: '#FFFFFF',
  surfaceVariant: '#F5F7FA',
  background: '#F0F2F5',
  onSurface: '#1A1A2E',
  onBackground: '#1A1A2E',

  grey50: '#FAFAFA',
  grey100: '#F5F5F5',
  grey200: '#EEEEEE',
  grey300: '#E0E0E0',
  grey400: '#BDBDBD',
  grey500: '#9E9E9E',
  grey600: '#757575',
  grey700: '#616161',
  grey800: '#424242',
  grey900: '#212121',

  // Estado / feedback
  success: '#2E7D32',
  successLight: '#E8F5E9',
  warning: '#F57F17',
  warningLight: '#FFF8E1',
  error: '#C62828',
  errorLight: '#FFEBEE',
  info: '#01579B',
  infoLight: '#E1F5FE',

  // Sincronización
  online: '#2E7D32',
  syncing: '#F57F17',
  offline: '#B71C1C',
  synced: '#0D4F8B',
  pendingSync: '#F9A825',

  // Estados de visita
  visitAssigned: '#01579B',
  visitInProgress: '#F57F17',
  visitCompleted: '#2E7D32',
  visitSynced: '#0D4F8B',
  visitError: '#C62828',

  // Texto
  textPrimary: '#1A1A2E',
  textSecondary: '#6B7280',
  textDisabled: '#BDBDBD',
  textInverse: '#FFFFFF',

  // Bordes
  border: '#E0E0E0',
  borderFocus: '#0D4F8B',

  // Fondo de modales (negro al 32 %)
  scrim: 'rgba(0, 0, 0, 0.32)',
  // Sombra de los botones flotantes
  shadow: '#000000',
} as const;

export type ColorToken = keyof typeof colors;

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

/**
 * Devuelve un color `#RRGGBB` con la opacidad indicada (0–1) en formato rgba.
 * Se usa, por ejemplo, para el fondo (12 %) y el borde (40 %) de los badges.
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = HEX_COLOR.exec(hex);
  if (!match?.[1]) return hex;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}
