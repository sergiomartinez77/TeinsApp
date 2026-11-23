/**
 * @jest-environment ./jest.skia-environment.js
 */
import { GRID_STEPS_CM, PLAN_ZOOM } from '../constants';
import { gridSpacing } from '../services/geometry';
import { gridLinesPath, gridStepFor } from '../services/grid-worklet';

/** Cuadrícula del hilo de la interfaz, con el simulador de Skia (CanvasKit). */

describe('gridStepFor', () => {
  it('da los mismos pasos que gridSpacing', () => {
    const scales = [PLAN_ZOOM.min, 0.0001, 0.01, 0.1, PLAN_ZOOM.initial, 1, 2.8, 14, PLAN_ZOOM.max];
    for (const scale of scales) {
      const { minor, major } = gridSpacing(scale);
      expect(gridStepFor(scale, 0)).toBe(minor);
      expect(gridStepFor(scale, 1)).toBe(major);
    }
  });

  it('usa los mismos pasos que GRID_STEPS_CM', () => {
    // Con una escala en la que cada paso deja 15 px (y el anterior, menos de 14), el paso fino es ese.
    for (const step of GRID_STEPS_CM) {
      expect(gridStepFor(15 / step, 0)).toBe(step);
    }
  });
});

describe('gridLinesPath', () => {
  it('traza las líneas visibles desplazadas con la vista', () => {
    // Cada 10 px; desplazamiento (5, −3): verticales en x = 5 y 15, horizontal en y = 7.
    const path = gridLinesPath(1, 5, -3, 20, 10, 10);

    expect(path.countPoints()).toBe(6);
    expect(path.toSVGString()).toBe('M5 0L5 10M15 0L15 10M0 7L20 7');
  });

  it('la separación es el paso por la escala', () => {
    // Paso de 50 cm con 1 m = 60 px: líneas cada 30 px desde 0.
    const path = gridLinesPath(PLAN_ZOOM.initial, 0, 0, 60, 30, 50);

    expect(path.toSVGString()).toBe('M0 0L0 30M30 0L30 30M60 0L60 30M0 0L60 0M0 30L60 30');
  });

  it('sin separación suficiente o sin área no traza nada', () => {
    // 10 cm con 0,1 px por cm = 1 px entre líneas (< 4 px).
    expect(gridLinesPath(0.1, 0, 0, 100, 100, 10).countPoints()).toBe(0);
    expect(gridLinesPath(1, 0, 0, 0, 100, 10).countPoints()).toBe(0);
    expect(gridLinesPath(1, 0, 0, 100, -1, 10).countPoints()).toBe(0);
    expect(gridLinesPath(Number.NaN, 0, 0, 100, 100, 10).countPoints()).toBe(0);
  });
});
