import { fireEvent, render, screen } from '@testing-library/react-native';

import type { FormResponse, FormTemplate } from '@/models/form.model';

import { VisitFormCard } from '../components/VisitFormCard';
import { buildTemplateCatalog } from '../services/template.service';
import {
  addableTemplates,
  buildVisitForms,
  formsSummaryText,
  formStateLabel,
  hasAnswer,
  progressLabel,
  requiredProgress,
  VISIT_FORMS_MESSAGES,
} from '../services/visit-forms';

const template = (id: string, visitType: string, name = id): FormTemplate => ({
  id,
  name,
  visitType,
  version: 1,
  isActive: true,
  source: 'asset',
  sections: [
    {
      id: 's1',
      title: 'Datos',
      order: 0,
      fields: [
        { id: 'a', type: 'text', label: 'A', required: true, hint: null, options: [], unit: null },
        {
          id: 'b',
          type: 'boolean',
          label: 'B',
          required: true,
          hint: null,
          options: [],
          unit: null,
        },
        {
          id: 'c',
          type: 'multiSelect',
          label: 'C',
          required: true,
          hint: null,
          options: ['x'],
          unit: null,
        },
        { id: 'd', type: 'text', label: 'D', required: false, hint: null, options: [], unit: null },
      ],
    },
  ],
});

const response = (overrides: Partial<FormResponse> = {}): FormResponse => ({
  id: 'r1',
  visitId: 'v1',
  templateId: null,
  templateKey: 'general_tpl',
  templateRef: 'general_tpl',
  templateVersion: 1,
  values: {},
  syncStatus: 'pendingSync',
  isComplete: false,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: null,
  completedAt: null,
  ...overrides,
});

const ASSETS = [
  template('general_tpl', 'general', 'Visita general'),
  template('ups_tpl', 'ups', 'Informe UPS'),
  template('energia_tpl', 'energia', 'Energía'),
];
const catalog = buildTemplateCatalog([], ASSETS);

describe('progreso de campos obligatorios', () => {
  it('cuenta respuestas no vacías (un "No" cuenta)', () => {
    expect(hasAnswer('  ')).toBe(false);
    expect(hasAnswer('x')).toBe(true);
    expect(hasAnswer([])).toBe(false);
    expect(hasAnswer(['x'])).toBe(true);
    expect(hasAnswer(false)).toBe(true);
    expect(hasAnswer(0)).toBe(true);
    expect(hasAnswer(undefined)).toBe(false);
    expect(requiredProgress(ASSETS[0] ?? null, { a: 'x', b: false, c: [], d: 'y' })).toEqual({
      filled: 2,
      total: 3,
    });
    expect(requiredProgress(null, { a: 'x' })).toEqual({ filled: 0, total: 0 });
  });

  it('textos', () => {
    expect(progressLabel({ filled: 2, total: 3 })).toBe('2 de 3 campos obligatorios');
    expect(progressLabel({ filled: 1, total: 1 })).toBe('1 de 1 campo obligatorio');
    expect(progressLabel({ filled: 0, total: 0 })).toBe(VISIT_FORMS_MESSAGES.noRequired);
    expect(formStateLabel({ isComplete: true })).toBe('Completado');
    expect(formStateLabel({ isComplete: false })).toBe('En curso');
  });
});

describe('buildVisitForms', () => {
  it('resuelve la plantilla de cada respuesta (incluida una antigua por tipo de visita)', () => {
    const forms = buildVisitForms(
      [
        response({ id: 'r1', values: { a: 'x' } }),
        response({ id: 'r2', templateKey: 'ups_tpl', templateRef: 'ups_tpl', isComplete: true }),
        // Antigua sin plantilla conocida: se resuelve por el tipo de la visita, como antes.
        response({ id: 'r3', templateKey: null, templateRef: null }),
      ],
      catalog,
      'general',
    );
    expect(forms.map((form) => [form.response.id, form.name, form.isComplete])).toEqual([
      ['r1', 'Visita general', false],
      ['r2', 'Informe UPS', true],
      ['r3', 'Visita general', false],
    ]);
    expect(forms[0]?.progress).toEqual({ filled: 1, total: 3 });
  });

  it('sin plantilla resoluble usa un nombre genérico', () => {
    const [form] = buildVisitForms(
      [response({ templateKey: 'x', templateRef: 'x' })],
      catalog,
      'otro',
    );
    expect(form?.name).toBe(VISIT_FORMS_MESSAGES.unknownTemplate);
    expect(form?.template).toBeNull();
  });
});

describe('addableTemplates', () => {
  it('ofrece solo las plantillas no usadas, primero las del tipo de visita', () => {
    const forms = buildVisitForms([response()], catalog, 'energia');
    expect(
      addableTemplates(catalog, forms, 'energia').map((o) => [o.template.id, o.recommended]),
    ).toEqual([
      ['energia_tpl', true],
      ['ups_tpl', false],
    ]);
    const none = buildVisitForms(
      ASSETS.map((t, i) => response({ id: `r${i}`, templateKey: t.id, templateRef: t.id })),
      catalog,
      'general',
    );
    expect(addableTemplates(catalog, none, 'general')).toEqual([]);
  });
});

describe('formsSummaryText', () => {
  it('"Sin iniciar" o "N formularios · M completados"', () => {
    expect(formsSummaryText([])).toBe('Sin iniciar');
    expect(formsSummaryText([{ isComplete: true }, { isComplete: false }])).toBe(
      '2 formularios · 1 completado',
    );
  });
});

describe('VisitFormCard', () => {
  it('muestra nombre, estado y progreso, y abre el formulario al tocarlo', async () => {
    const [form] = buildVisitForms([response({ values: { a: 'x' } })], catalog, 'general');
    if (!form) throw new Error('sin formulario');
    const onPress = jest.fn();
    await render(<VisitFormCard form={form} onPress={onPress} />);

    const card = screen.getByLabelText('Visita general, En curso, 1 de 3 campos obligatorios');
    expect(screen.getByText('En curso')).toBeOnTheScreen();
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledWith(form);
  });

  it('formulario completado', async () => {
    const [form] = buildVisitForms([response({ isComplete: true })], catalog, 'general');
    if (!form) throw new Error('sin formulario');
    await render(<VisitFormCard form={form} onPress={jest.fn()} />);
    expect(screen.getByText('Completado')).toBeOnTheScreen();
  });
});
