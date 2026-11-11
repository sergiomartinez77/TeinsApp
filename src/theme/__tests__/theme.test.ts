import {
  colors,
  isSplitViewWidth,
  isTabletWidth,
  radius,
  spacing,
  typography,
  withAlpha,
} from '@/theme';

describe('tema TEINS', () => {
  it('conserva los colores corporativos exactos', () => {
    expect(colors.primary).toBe('#0D4F8B');
    expect(colors.secondary).toBe('#00A878');
    expect(colors.background).toBe('#F0F2F5');
    expect(colors.error).toBe('#C62828');
    expect(colors.offline).toBe('#B71C1C');
    expect(colors.pendingSync).toBe('#F9A825');
    expect(colors.visitInProgress).toBe('#F57F17');
  });

  it('todos los colores son hexadecimales o rgba válidos', () => {
    for (const value of Object.values(colors)) {
      expect(value).toMatch(/^(#[0-9A-F]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/);
    }
  });

  it('el espaciado usa múltiplos de 4 y el área táctil mínima es 48', () => {
    for (const value of Object.values(spacing)) {
      expect(value % 4).toBe(0);
    }
    expect(spacing.minTouchTarget).toBe(48);
    expect(radius.md).toBe(12);
    expect(radius.full).toBe(999);
  });

  it('la escala tipográfica coincide con la original', () => {
    expect(typography.headlineLarge).toMatchObject({ fontSize: 32, fontWeight: '700' });
    expect(typography.titleMedium).toMatchObject({ fontSize: 16, fontWeight: '600' });
    expect(typography.bodySmall).toMatchObject({ fontSize: 12, color: colors.textSecondary });
    expect(typography.labelSmall).toMatchObject({ fontSize: 11, fontWeight: '500' });
  });

  it('withAlpha convierte un color hexadecimal a rgba', () => {
    expect(withAlpha('#0D4F8B', 0.12)).toBe('rgba(13, 79, 139, 0.12)');
    expect(withAlpha('#FFFFFF', 2)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('no-es-color', 0.5)).toBe('no-es-color');
  });

  it('detecta los anchos de tablet y de vista dividida', () => {
    expect(isTabletWidth(600)).toBe(false);
    expect(isTabletWidth(601)).toBe(true);
    expect(isSplitViewWidth(700)).toBe(false);
    expect(isSplitViewWidth(768)).toBe(true);
  });
});
