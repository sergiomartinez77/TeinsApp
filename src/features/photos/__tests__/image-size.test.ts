import { needsResize, targetImageSize } from '../services/image-size';

describe('targetImageSize', () => {
  it('reduce una foto horizontal grande para que quepa en 1920 × 1080', () => {
    expect(targetImageSize({ width: 4000, height: 3000 })).toEqual({ width: 1440, height: 1080 });
    expect(targetImageSize({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
  });

  it('reduce una foto vertical grande para que quepa en 1080 × 1920', () => {
    expect(targetImageSize({ width: 3000, height: 4000 })).toEqual({ width: 1080, height: 1440 });
    expect(targetImageSize({ width: 2160, height: 3840 })).toEqual({ width: 1080, height: 1920 });
  });

  it('no amplía una foto pequeña', () => {
    expect(targetImageSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(needsResize({ width: 800, height: 600 })).toBe(false);
  });

  it('una foto cuadrada cabe en 1080 × 1080', () => {
    expect(targetImageSize({ width: 3000, height: 3000 })).toEqual({ width: 1080, height: 1080 });
  });

  it('conserva la proporción', () => {
    const source = { width: 4032, height: 3024 };
    const target = targetImageSize(source);
    expect(target.width / target.height).toBeCloseTo(source.width / source.height, 2);
    expect(target.width).toBeLessThanOrEqual(1920);
    expect(target.height).toBeLessThanOrEqual(1080);
  });

  it('devuelve siempre enteros', () => {
    const target = targetImageSize({ width: 4001, height: 2999 });
    expect(Number.isInteger(target.width)).toBe(true);
    expect(Number.isInteger(target.height)).toBe(true);
    expect(needsResize({ width: 4001, height: 2999 })).toBe(true);
  });

  it('con tamaño desconocido devuelve 0 × 0', () => {
    expect(targetImageSize({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
  });
});
