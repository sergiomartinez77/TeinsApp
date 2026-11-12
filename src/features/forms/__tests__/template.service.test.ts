import { templateFromAsset, templateFromRow, type FormTemplate } from '@/models/form.model';

import {
  ASSET_TEMPLATES,
  buildTemplateCatalog,
  findTemplate,
  resolveTemplateForResponse,
  sortTemplatesForSelector,
} from '../services/template.service';

const sections = (fieldId = 'campo') =>
  JSON.stringify([
    {
      id: 's1',
      title: 'Datos',
      order: 0,
      fields: [{ id: fieldId, type: 'text', label: 'Campo', required: true }],
    },
  ]);

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'UPS servidor',
  visit_type: 'ups',
  version: 1,
  sections_json: sections(),
  is_active: 1,
  ...overrides,
});

const asset = (id: string, visitType: string, name = id): FormTemplate => {
  const template = templateFromAsset({
    id,
    name,
    visit_type: visitType,
    version: 1,
    sections: [{ id: 's', title: 'S', order: 0, fields: [{ id: 'a', type: 'text', label: 'A' }] }],
  });
  if (!template) throw new Error('plantilla de prueba inválida');
  return template;
};

const ASSETS = [asset('general_v1', 'general'), asset('ups_v1', 'ups')];

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('templateFromRow', () => {
  it('lee la plantilla de la base con sus secciones ordenadas', () => {
    const template = templateFromRow(
      row({
        sections_json: JSON.stringify([
          { id: 'b', title: 'Segunda', order: 2, fields: [{ id: 'y', type: 'text', label: 'Y' }] },
          {
            id: 'a',
            title: 'Primera',
            order: 1,
            fields: [{ id: 'x', type: 'boolean', label: 'X' }],
          },
        ]),
      }),
    );

    expect(template).toMatchObject({ source: 'database', isActive: true, version: 1 });
    expect(template?.sections.map((section) => section.title)).toEqual(['Primera', 'Segunda']);
  });

  it.each([
    ['JSON inválido', '{no es json'],
    ['lista vacía', '[]'],
    ['sin columna', null],
    ['secciones sin campos', JSON.stringify([{ id: 's', title: 'S', order: 0, fields: [] }])],
  ])('descarta la plantilla con %s', (_caso, value) => {
    expect(templateFromRow(row({ sections_json: value }))).toBeNull();
  });

  it('muestra como texto un tipo de campo desconocido', () => {
    const template = templateFromRow(
      row({
        sections_json: JSON.stringify([
          { id: 's', title: 'S', order: 0, fields: [{ id: 'f', type: 'firma', label: 'Firma' }] },
        ]),
      }),
    );

    expect(template?.sections[0]?.fields[0]?.type).toBe('text');
  });
});

describe('buildTemplateCatalog', () => {
  it('la plantilla de la base tapa a la del asset del mismo tipo', () => {
    const catalog = buildTemplateCatalog([row()], ASSETS);

    expect(catalog.available.map((template) => template.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      'general_v1',
    ]);
  });

  it('por tipo de visita gana la versión mayor', () => {
    const catalog = buildTemplateCatalog(
      [row({ id: 'v1', version: 1 }), row({ id: 'v3', version: 3 }), row({ id: 'v2', version: 2 })],
      ASSETS,
    );

    const ups = catalog.available.filter((template) => template.visitType === 'ups');
    expect(ups.map((template) => template.id)).toEqual(['v3']);
  });

  it('las plantillas inactivas no se ofrecen, pero se conservan para respuestas antiguas', () => {
    const catalog = buildTemplateCatalog([row({ id: 'vieja', is_active: 0 })], ASSETS);

    expect(catalog.available.map((template) => template.id)).toEqual(['general_v1', 'ups_v1']);
    expect(findTemplate(catalog, 'vieja')).toMatchObject({ id: 'vieja', isActive: false });
  });

  it('descarta las filas con secciones inválidas sin romper el resto', () => {
    const catalog = buildTemplateCatalog([row({ sections_json: 'xx' })], ASSETS);

    expect(catalog.database).toHaveLength(0);
    expect(catalog.available).toHaveLength(2);
  });

  it('sin base usa las 5 plantillas de respaldo de la app', () => {
    expect(buildTemplateCatalog([]).available).toHaveLength(ASSET_TEMPLATES.length);
  });
});

describe('resolveTemplateForResponse', () => {
  const catalog = buildTemplateCatalog([row({ id: 'db-ups' })], ASSETS);

  it('por template_id', () => {
    expect(
      resolveTemplateForResponse(catalog, { templateId: 'db-ups', templateKey: null }, 'general')
        ?.id,
    ).toBe('db-ups');
  });

  it('por la clave del asset aunque la base ya tenga otra plantilla del tipo', () => {
    expect(
      resolveTemplateForResponse(catalog, { templateId: null, templateKey: 'ups_v1' }, 'ups')?.id,
    ).toBe('ups_v1');
  });

  it('por el tipo de la visita si no hay referencia', () => {
    expect(
      resolveTemplateForResponse(catalog, { templateId: null, templateKey: null }, 'general')?.id,
    ).toBe('general_v1');
    expect(
      resolveTemplateForResponse(catalog, { templateId: 'borrada', templateKey: null }, 'ups')?.id,
    ).toBe('db-ups');
  });

  it('devuelve null si no hay ninguna plantilla aplicable', () => {
    expect(
      resolveTemplateForResponse(catalog, { templateId: null, templateKey: null }, 'datos'),
    ).toBeNull();
  });
});

describe('sortTemplatesForSelector', () => {
  it('pone primero las del tipo de la visita y luego ordena por nombre', () => {
    const templates = [
      asset('c', 'datos', 'Zeta'),
      asset('b', 'ups', 'UPS B'),
      asset('a', 'energia', 'Alfa'),
      asset('d', 'ups', 'UPS A'),
    ];

    const sorted = sortTemplatesForSelector(templates, 'ups');

    expect(sorted.map((option) => [option.template.name, option.recommended])).toEqual([
      ['UPS A', true],
      ['UPS B', true],
      ['Alfa', false],
      ['Zeta', false],
    ]);
  });
});
