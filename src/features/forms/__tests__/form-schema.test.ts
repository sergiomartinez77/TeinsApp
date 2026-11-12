import { templateFromAsset, type FormTemplate } from '@/models/form.model';

import {
  formatDateValue,
  parseDateValue,
  toDateValue,
  toTimeValue,
} from '../services/field-format';
import {
  draftFromValues,
  draftToValues,
  FORM_MESSAGES,
  parseNumberInput,
  sectionsWithErrors,
  validateDraft,
  type FormDraft,
} from '../services/form-schema';

function buildTemplate(): FormTemplate {
  const template = templateFromAsset({
    id: 'prueba',
    name: 'Prueba',
    visit_type: 'general',
    version: 2,
    sections: [
      {
        id: 'datos',
        title: 'Datos',
        order: 0,
        fields: [
          { id: 'nombre', type: 'text', label: 'Nombre', required: true },
          { id: 'notas', type: 'textarea', label: 'Notas', required: false },
          { id: 'cantidad', type: 'number', label: 'Cantidad', required: true },
          { id: 'voltaje', type: 'decimal', label: 'Voltaje', required: false, unit: 'V' },
        ],
      },
      {
        id: 'estado',
        title: 'Estado',
        order: 1,
        fields: [
          { id: 'funciona', type: 'boolean', label: '¿Funciona?', required: true },
          { id: 'fecha', type: 'date', label: 'Fecha', required: true },
          { id: 'hora', type: 'time', label: 'Hora', required: false },
          { id: 'tipo', type: 'select', label: 'Tipo', required: true, options: ['A', 'B'] },
          {
            id: 'sistemas',
            type: 'multiSelect',
            label: 'Sistemas',
            required: true,
            options: ['CCTV', 'UPS'],
          },
        ],
      },
    ],
  });
  if (!template) throw new Error('plantilla de prueba inválida');
  return template;
}

const template = buildTemplate();
const empty = () => draftFromValues(template, {});
const valid = (): FormDraft => ({
  ...empty(),
  nombre: 'Juan',
  cantidad: '3',
  funciona: false,
  fecha: '2026-11-11',
  tipo: 'A',
  sistemas: ['UPS'],
});

describe('valores iniciales', () => {
  it('cada tipo empieza vacío: texto, sin responder o lista vacía', () => {
    expect(empty()).toEqual({
      nombre: '',
      notas: '',
      cantidad: '',
      voltaje: '',
      funciona: null,
      fecha: '',
      hora: '',
      tipo: '',
      sistemas: [],
    });
  });

  it('carga las respuestas guardadas en el formato de cada control', () => {
    const draft = draftFromValues(template, {
      nombre: 'Ana',
      cantidad: 4,
      voltaje: 220.5,
      funciona: true,
      sistemas: ['CCTV'],
      ajeno: 'no está en la plantilla',
    });

    expect(draft).toMatchObject({
      nombre: 'Ana',
      cantidad: '4',
      voltaje: '220.5',
      funciona: true,
      sistemas: ['CCTV'],
    });
    expect(draft).not.toHaveProperty('ajeno');
  });
});

describe('validación', () => {
  it('marca como obligatorios los requeridos vacíos y deja pasar los opcionales', () => {
    expect(validateDraft(template, empty())).toEqual({
      nombre: FORM_MESSAGES.required,
      cantidad: FORM_MESSAGES.required,
      funciona: FORM_MESSAGES.required,
      fecha: FORM_MESSAGES.required,
      tipo: FORM_MESSAGES.required,
      sistemas: FORM_MESSAGES.required,
    });
  });

  it('un formulario completo es válido', () => {
    expect(validateDraft(template, valid())).toEqual({});
  });

  it('un texto con solo espacios cuenta como vacío', () => {
    expect(validateDraft(template, { ...valid(), nombre: '   ' })).toEqual({
      nombre: FORM_MESSAGES.required,
    });
  });

  it('"No" es una respuesta válida para un sí/no obligatorio', () => {
    expect(validateDraft(template, { ...valid(), funciona: false })).toEqual({});
    expect(validateDraft(template, { ...valid(), funciona: null })).toEqual({
      funciona: FORM_MESSAGES.required,
    });
  });

  it('los números deben ser válidos; los enteros no admiten decimales', () => {
    expect(validateDraft(template, { ...valid(), cantidad: 'tres' })).toEqual({
      cantidad: FORM_MESSAGES.invalidNumber,
    });
    expect(validateDraft(template, { ...valid(), cantidad: '2,5' })).toEqual({
      cantidad: FORM_MESSAGES.integerOnly,
    });
    expect(validateDraft(template, { ...valid(), voltaje: '12abc' })).toEqual({
      voltaje: FORM_MESSAGES.invalidNumber,
    });
    expect(validateDraft(template, { ...valid(), voltaje: '220,5' })).toEqual({});
  });

  it('selección múltiple obligatoria necesita al menos una opción', () => {
    expect(validateDraft(template, { ...valid(), sistemas: [] })).toEqual({
      sistemas: FORM_MESSAGES.required,
    });
  });
});

describe('parseNumberInput', () => {
  it('acepta coma o punto en decimales y solo enteros en número', () => {
    expect(parseNumberInput('220,5', 'decimal')).toBe(220.5);
    expect(parseNumberInput(' 0.75 ', 'decimal')).toBe(0.75);
    expect(parseNumberInput('-3', 'decimal')).toBe(-3);
    expect(parseNumberInput('12', 'number')).toBe(12);
    expect(parseNumberInput('12.5', 'number')).toBeNull();
    expect(parseNumberInput('1.2.3', 'decimal')).toBeNull();
    expect(parseNumberInput('', 'decimal')).toBeNull();
  });
});

describe('draftToValues', () => {
  it('guarda números como número, recorta textos y omite los vacíos', () => {
    const values = draftToValues(template, {
      ...empty(),
      nombre: '  Juan  ',
      notas: '   ',
      cantidad: '7',
      voltaje: '110,25',
      funciona: false,
      hora: '08:30',
      sistemas: ['CCTV', 'UPS'],
    });

    expect(values).toEqual({
      nombre: 'Juan',
      cantidad: 7,
      voltaje: 110.25,
      funciona: false,
      hora: '08:30',
      sistemas: ['CCTV', 'UPS'],
    });
  });

  it('no guarda un número inválido ni un sí/no sin responder', () => {
    const values = draftToValues(template, { ...empty(), cantidad: 'abc', funciona: null });

    expect(values).not.toHaveProperty('cantidad');
    expect(values).not.toHaveProperty('funciona');
  });
});

describe('sectionsWithErrors', () => {
  it('devuelve las secciones con errores en el orden de la plantilla', () => {
    expect(sectionsWithErrors(template, ['sistemas', 'nombre'])).toEqual(['datos', 'estado']);
    expect(sectionsWithErrors(template, ['fecha'])).toEqual(['estado']);
    expect(sectionsWithErrors(template, [])).toEqual([]);
  });
});

describe('formato de fecha y hora', () => {
  it('guarda fecha local YYYY-MM-DD y hora HH:mm', () => {
    const date = new Date(2026, 0, 5, 7, 9);

    expect(toDateValue(date)).toBe('2026-01-05');
    expect(toTimeValue(date)).toBe('07:09');
    expect(parseDateValue('2026-02-30')).toBeNull();
    expect(formatDateValue('2026-11-11')).toBe('miércoles, 11 de noviembre de 2026');
  });
});
