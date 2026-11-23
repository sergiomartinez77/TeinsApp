import { summarizeMaterials, type VisitMaterial } from '@/models/material.model';

import {
  annotationsStatusText,
  formsStatusText,
  materialsStatusText,
  photosStatusText,
  sectionStatusText,
  SUMMARY_MESSAGES,
} from '../services/visit-summary';

const material = (
  unit: string,
  quantity: number,
  id = `vm-${unit}-${quantity}`,
): VisitMaterial => ({
  id,
  visitId: 'v1',
  materialId: id,
  isCustom: false,
  materialCode: 'COD',
  materialName: 'Material',
  unit,
  quantity,
  observations: null,
  syncStatus: 'pendingSync',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
});

// Cambiado: antes había un formulario por visita ("En curso · <plantilla>"); ahora
// hay varios y el resumen muestra cuántos hay y cuántos están completados.
describe('formsStatusText (varios formularios por visita)', () => {
  it('sin formularios indica "Sin iniciar"', () => {
    expect(formsStatusText([])).toBe('Sin iniciar');
  });

  it('un formulario en curso', () => {
    expect(formsStatusText([{ isComplete: false }])).toBe('1 formulario · 0 completados');
  });

  it('un formulario completado (singular)', () => {
    expect(formsStatusText([{ isComplete: true }])).toBe('1 formulario · 1 completado');
  });

  it('varios formularios, algunos completados', () => {
    expect(
      formsStatusText([{ isComplete: true }, { isComplete: false }, { isComplete: true }]),
    ).toBe('3 formularios · 2 completados');
  });
});

describe('materialsStatusText', () => {
  it('con personalizados los cuenta antes de los totales', () => {
    expect(
      materialsStatusText({
        count: 2,
        countLabel: '2 materiales',
        totals: [],
        totalsLabel: '3 metro',
        customLabel: '1 personalizado',
      }),
    ).toBe('2 materiales · 1 personalizado · 3 metro');
  });

  it('sin materiales', () => {
    expect(materialsStatusText(summarizeMaterials([]))).toBe('Sin materiales');
  });

  it('un material con su total', () => {
    expect(materialsStatusText(summarizeMaterials([material('metro', 12.5)]))).toBe(
      '1 material · 12,5 metro',
    );
  });

  it('varios materiales con totales por unidad', () => {
    const summary = summarizeMaterials([
      material('metro', 100, 'a'),
      material('unidad', 4, 'b'),
      material('metro', 20, 'c'),
      material('unidad', 10, 'd'),
    ]);
    expect(materialsStatusText(summary)).toBe('4 materiales · 120 metro · 14 unidad');
  });

  it('sin totales muestra solo el conteo', () => {
    expect(
      materialsStatusText({ count: 2, countLabel: '2 materiales', totals: [], totalsLabel: '' }),
    ).toBe('2 materiales');
  });
});

describe('photosStatusText', () => {
  it('sin fotografías', () => {
    expect(photosStatusText(0, 0)).toBe('Sin fotografías');
  });

  it('una fotografía sin pendientes', () => {
    expect(photosStatusText(1, 0)).toBe('1 fotografía');
  });

  it('varias fotografías sin pendientes', () => {
    expect(photosStatusText(5, 0)).toBe('5 fotografías');
  });

  it('con fotografías pendientes de subir', () => {
    expect(photosStatusText(1, 1)).toBe('1 fotografía · 1 por subir');
    expect(photosStatusText(5, 2)).toBe('5 fotografías · 2 por subir');
  });
});

describe('annotationsStatusText', () => {
  it('sin planos', () => {
    expect(annotationsStatusText(0, 0)).toBe(SUMMARY_MESSAGES.noAnnotations);
    expect(annotationsStatusText(0, 5)).toBe('Sin planos');
  });

  it('un plano vacío o con un elemento', () => {
    expect(annotationsStatusText(1, 0)).toBe('1 plano · 0 elementos');
    expect(annotationsStatusText(1, 1)).toBe('1 plano · 1 elemento');
  });

  it('varios planos suman sus elementos', () => {
    expect(annotationsStatusText(3, 7)).toBe('3 planos · 7 elementos');
  });

  it('un recuento negativo de elementos cuenta como cero', () => {
    expect(annotationsStatusText(2, -4)).toBe('2 planos · 0 elementos');
  });
});

describe('sectionStatusText', () => {
  const build = jest.fn(() => 'Texto de la sección');

  beforeEach(() => build.mockClear());

  it('si la consulta falla muestra "No disponible"', () => {
    expect(sectionStatusText({ isLoading: false, hasError: true }, build)).toBe('No disponible');
    expect(build).not.toHaveBeenCalled();
  });

  it('mientras carga muestra "Cargando..."', () => {
    expect(sectionStatusText({ isLoading: true, hasError: false }, build)).toBe(
      SUMMARY_MESSAGES.loading,
    );
  });

  it('con los datos cargados devuelve el texto de la sección', () => {
    expect(sectionStatusText({ isLoading: false, hasError: false }, build)).toBe(
      'Texto de la sección',
    );
  });
});
