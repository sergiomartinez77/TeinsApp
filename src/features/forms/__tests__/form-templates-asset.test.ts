import assetJson from '@/assets/form_templates.json';
import {
  allFields,
  countFields,
  FORM_FIELD_TYPES,
  isFormFieldType,
  templatesFromAsset,
} from '@/models/form.model';

import { ASSET_TEMPLATES } from '../services/template.service';

interface RawField {
  id: string;
  type: string;
}
interface RawTemplate {
  id: string;
  visit_type: string;
  sections: { fields: RawField[] }[];
}

const raw = assetJson as unknown as RawTemplate[];

describe('plantillas de respaldo (asset)', () => {
  it('son exactamente 5 plantillas con los tipos de visita esperados', () => {
    expect(raw).toHaveLength(5);
    expect(ASSET_TEMPLATES.map((template) => [template.id, template.visitType])).toEqual([
      ['teins_visita_v1', 'general'],
      ['ups_cdp_v1', 'ups'],
      ['infraestructura_v1', 'infraestructura'],
      ['energia_v1', 'energia'],
      ['datos_v1', 'datos'],
    ]);
  });

  it('todas se parsean sin perder secciones ni campos', () => {
    const parsed = templatesFromAsset(assetJson);

    expect(parsed).toHaveLength(raw.length);
    parsed.forEach((template, index) => {
      const source = raw[index];
      const rawFieldCount =
        source?.sections.reduce((total, section) => total + section.fields.length, 0) ?? 0;
      expect(template.source).toBe('asset');
      expect(template.sections).toHaveLength(source?.sections.length ?? -1);
      expect(countFields(template)).toBe(rawFieldCount);
    });
  });

  it('todos los tipos de campo están soportados y se usan todos', () => {
    const rawTypes = new Set(
      raw.flatMap((template) =>
        template.sections.flatMap((section) => section.fields.map((field) => field.type)),
      ),
    );

    rawTypes.forEach((type) => expect(isFormFieldType(type)).toBe(true));
    expect([...rawTypes].sort()).toEqual([...FORM_FIELD_TYPES].sort());
  });

  it('los ids de campo son únicos dentro de cada plantilla', () => {
    raw.forEach((template) => {
      const ids = template.sections.flatMap((section) => section.fields.map((field) => field.id));
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('los campos de selección tienen opciones y las secciones están ordenadas', () => {
    ASSET_TEMPLATES.forEach((template) => {
      allFields(template)
        .filter((field) => field.type === 'select' || field.type === 'multiSelect')
        .forEach((field) => expect(field.options.length).toBeGreaterThan(0));
      const orders = template.sections.map((section) => section.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });
  });
});
