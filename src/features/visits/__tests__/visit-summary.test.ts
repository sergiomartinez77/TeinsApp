import { summarizeMaterials, type VisitMaterial } from '@/models/material.model';

import {
  annotationsStatusText,
  formStatusText,
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
  materialCode: 'COD',
  materialName: 'Material',
  unit,
  quantity,
  observations: null,
  syncStatus: 'pendingSync',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
});

describe('formStatusText', () => {
  it('sin respuesta indica "Sin iniciar"', () => {
    expect(formStatusText(null, 'Revisión eléctrica')).toBe('Sin iniciar');
  });

  it('en curso muestra el nombre de la plantilla', () => {
    expect(formStatusText({ isComplete: false }, 'Revisión eléctrica')).toBe(
      'En curso · Revisión eléctrica',
    );
  });

  it('completado muestra el nombre de la plantilla', () => {
    expect(formStatusText({ isComplete: true }, 'Revisión eléctrica')).toBe(
      'Completado · Revisión eléctrica',
    );
  });

  it('sin plantilla conocida muestra solo el estado', () => {
    expect(formStatusText({ isComplete: false }, null)).toBe('En curso');
    expect(formStatusText({ isComplete: true }, null)).toBe('Completado');
    expect(formStatusText({ isComplete: true }, '   ')).toBe('Completado');
  });
});

describe('materialsStatusText', () => {
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
  it('sin anotaciones', () => {
    expect(annotationsStatusText(0)).toBe('Sin anotaciones');
  });

  it('un elemento', () => {
    expect(annotationsStatusText(1)).toBe('1 elemento');
  });

  it('varios elementos', () => {
    expect(annotationsStatusText(7)).toBe('7 elementos');
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
