/** Espaciado basado en múltiplos de 4. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,

  screenHorizontal: 16,
  screenVertical: 16,
  cardPadding: 16,
  listItemSpacing: 8,
  /** Área táctil mínima (WCAG 2.1). */
  minTouchTarget: 48,
} as const;

export const radius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

/** Anchos (dp) a partir de los cuales se usa el layout de tablet. */
export const breakpoints = {
  /** Formularios y pantallas de una columna. */
  tablet: 600,
  /** Vistas divididas (detalle de visita). */
  splitView: 700,
} as const;

/** Ancho máximo del contenido centrado en tablet (login, formularios). */
export const maxContentWidth = 480;

export function isTabletWidth(width: number): boolean {
  return width > breakpoints.tablet;
}

export function isSplitViewWidth(width: number): boolean {
  return width > breakpoints.splitView;
}
