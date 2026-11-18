import { renderHook, waitFor } from '@testing-library/react-native';

import { responseFromRow, TEMPLATE_KEY } from '@/models/form.model';
import { responseRow, TECH_A, templateRow, visitRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import {
  formResponseQuery,
  useFormResponseFor,
  useVisitFormResponses,
} from '../hooks/useVisitForms';
import {
  completeFormResponse,
  RESPONSE_BY_ID_SQL,
  RESPONSE_BY_TEMPLATE_SQL,
  RESPONSE_BY_VISIT_SQL,
  RESPONSE_MESSAGES,
  saveFormResponse,
  VISIT_RESPONSES_SQL,
} from '../services/response.service';
import { buildTemplateCatalog } from '../services/template.service';
import { addableTemplates, buildVisitForms, formsSummaryText } from '../services/visit-forms';

/** Varios formularios por visita (uno por plantilla) contra SQLite real. */

jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const T1 = new Date('2026-06-10T12:00:00.000Z');
const T2 = new Date('2026-06-10T12:05:00.000Z');
const T3 = new Date('2026-06-10T12:10:00.000Z');
const DB_TEMPLATE = { id: 'tpl-db-1', version: 3, source: 'database' as const };
const DB_TEMPLATE_2 = { id: 'tpl-db-2', version: 1, source: 'database' as const };
const ASSET_TEMPLATE = { id: 'ups_cdp_v1', version: 1, source: 'asset' as const };

let db: TestDatabase;

beforeEach(() => {
  resetIds('respuesta');
  db = createTestDatabase();
  db.insert('visits', [
    visitRow({ id: 'v1', status: 'inProgress' }),
    visitRow({ id: 'v2', status: 'inProgress' }),
  ]);
  db.insert('form_templates', [
    templateRow({ id: 'tpl-db-1', name: 'Plantilla de la base' }),
    templateRow({ id: 'tpl-db-2', name: 'Revisión eléctrica', visit_type: 'energia', version: 1 }),
  ]);
  setTestDatabase(db);
});

afterEach(() => setTestDatabase(null));

const visit = (id: string) => db.get<Row>('SELECT * FROM visits WHERE id = ?', [id]);
const save = (
  template: typeof DB_TEMPLATE | typeof ASSET_TEMPLATE,
  values: Record<string, string>,
  at = T1,
) => saveFormResponse(db, TECH_A, { visitId: 'v1', template, values }, at);

describe('saveFormResponse con varios formularios', () => {
  it('cada plantilla crea su propia fila con template_key; guardar de nuevo actualiza la suya', async () => {
    await save(DB_TEMPLATE, { f1: 'uno' }, T1);
    await save(ASSET_TEMPLATE, { equipo: 'UPS' }, T2);
    await save(DB_TEMPLATE, { f1: 'dos' }, T3);

    const rows = await db.getAll<Row>(VISIT_RESPONSES_SQL, ['v1']);
    expect(rows.map((row) => [row.id, row.template_key, row.template_id])).toEqual([
      ['respuesta-1', 'tpl-db-1', 'tpl-db-1'],
      ['respuesta-2', 'ups_cdp_v1', null],
    ]);
    expect(responseFromRow(rows[0] ?? {}).values).toEqual({ f1: 'dos' });
    expect(JSON.parse(String(rows[1]?.responses))).toEqual({
      equipo: 'UPS',
      [TEMPLATE_KEY]: 'ups_cdp_v1',
    });
  });

  it('solo el PRIMER formulario queda registrado en la visita (no se sobrescribe)', async () => {
    await save(DB_TEMPLATE, { f1: 'uno' }, T1);
    await save(DB_TEMPLATE_2, { x: 'y' }, T2);
    await save(ASSET_TEMPLATE, { equipo: 'UPS' }, T3);

    expect(await visit('v1')).toMatchObject({
      form_template_id: 'tpl-db-1',
      form_template_version: 3,
      updated_at: T1.toISOString(),
    });
  });

  it('completar un formulario no completa ni bloquea los demás', async () => {
    await save(DB_TEMPLATE, { f1: 'uno' }, T1);
    await completeFormResponse(
      db,
      TECH_A,
      { visitId: 'v1', template: DB_TEMPLATE, values: { f1: 'final' } },
      T2,
    );
    const blocked = await save(DB_TEMPLATE, { f1: 'tarde' }, T3);
    expect(!blocked.ok && blocked.error.message).toBe(RESPONSE_MESSAGES.alreadyComplete);

    const other = await save(ASSET_TEMPLATE, { equipo: 'UPS' }, T3);
    expect(other.ok && other.data.isComplete).toBe(false);
  });

  it('con responseId actualiza esa fila aunque su clave sea antigua', async () => {
    // Respuesta antigua cuya plantilla ya no existe (se resuelve por tipo de visita).
    db.insert('form_responses', [
      responseRow({ id: 'r-antigua', template_id: 'tpl-borrada', responses: '{"f1":"a"}' }),
    ]);
    const result = await saveFormResponse(
      db,
      TECH_A,
      { visitId: 'v1', template: DB_TEMPLATE, values: { f1: 'b' }, responseId: 'r-antigua' },
      T1,
    );
    expect(result.ok && result.data.id).toBe('r-antigua');
    expect(db.rows('form_responses')).toHaveLength(1);
  });

  it('una fila creada por la versión anterior (sin template_key) se encuentra por template_id o por la clave del JSON', async () => {
    db.insert('form_responses', [
      responseRow({ id: 'r-db', template_id: 'tpl-db-1', responses: '{"f1":"a"}' }),
      responseRow({
        id: 'r-asset',
        responses: JSON.stringify({ equipo: 'X', [TEMPLATE_KEY]: 'ups_cdp_v1' }),
      }),
      responseRow({ id: 'r-rota', visit_id: 'v2', responses: '{no es json' }),
    ]);

    expect((await db.get<Row>(RESPONSE_BY_TEMPLATE_SQL, ['v1', 'tpl-db-1'])).id).toBe('r-db');
    expect((await db.get<Row>(RESPONSE_BY_TEMPLATE_SQL, ['v1', 'ups_cdp_v1'])).id).toBe('r-asset');
    // Un JSON roto no rompe la consulta.
    expect(await db.getAll(RESPONSE_BY_TEMPLATE_SQL, ['v2', 'ups_cdp_v1'])).toEqual([]);

    await save(DB_TEMPLATE, { f1: 'b' }, T1);
    await save(ASSET_TEMPLATE, { equipo: 'Y' }, T1);
    expect(db.rows('form_responses')).toHaveLength(3);
  });

  it('RESPONSE_BY_ID_SQL solo devuelve la respuesta de esa visita', async () => {
    db.insert('form_responses', [responseRow({ id: 'r1', visit_id: 'v2' })]);
    expect(await db.getAll(RESPONSE_BY_ID_SQL, ['r1', 'v1'])).toEqual([]);
    expect(await db.getAll(RESPONSE_BY_ID_SQL, ['r1', 'v2'])).toHaveLength(1);
  });
});

describe('lista y resumen con datos reales', () => {
  it('lista los formularios con su plantilla, progreso y lo que aún se puede agregar', async () => {
    await save(DB_TEMPLATE, { f1: 'listo' }, T1);
    await save(ASSET_TEMPLATE, {}, T2);
    const rows = await db.getAll<Row>(VISIT_RESPONSES_SQL, ['v1']);
    const catalog = buildTemplateCatalog(await db.getAll<Row>('SELECT * FROM form_templates'));

    const forms = buildVisitForms(rows.map(responseFromRow), catalog, 'general');
    expect(forms.map((form) => [form.name, form.progress])).toEqual([
      ['Plantilla de la base', { filled: 1, total: 1 }],
      ['Informe Técnico UPS (CDP)', expect.objectContaining({ filled: 0 })],
    ]);
    const addable = addableTemplates(catalog, forms, 'general').map((o) => o.template.id);
    expect(addable).not.toContain('tpl-db-1');
    expect(addable).not.toContain('ups_cdp_v1');
    expect(addable).toContain('tpl-db-2');
    expect(formsSummaryText(forms)).toBe('2 formularios · 0 completados');
  });
});

describe('hooks', () => {
  it('formResponseQuery elige por id, por plantilla o la primera de la visita', () => {
    expect(formResponseQuery('v1', { responseId: 'r1', templateId: 't' })).toEqual({
      sql: RESPONSE_BY_ID_SQL,
      parameters: ['r1', 'v1'],
    });
    expect(formResponseQuery('v1', { templateId: 't' })).toEqual({
      sql: RESPONSE_BY_TEMPLATE_SQL,
      parameters: ['v1', 't'],
    });
    expect(formResponseQuery('v1', {})).toEqual({
      sql: RESPONSE_BY_VISIT_SQL,
      parameters: ['v1'],
    });
  });

  it('useVisitFormResponses y useFormResponseFor leen la base y se actualizan', async () => {
    const list = await renderHook(() => useVisitFormResponses('v1'));
    const one = await renderHook(() => useFormResponseFor('v1', { templateId: 'ups_cdp_v1' }));
    expect(list.result.current.responses).toEqual([]);
    expect(one.result.current.response).toBeNull();

    await save(ASSET_TEMPLATE, { equipo: 'UPS' }, T1);

    await waitFor(() => expect(list.result.current.responses).toHaveLength(1));
    await waitFor(() => expect(one.result.current.response?.values).toEqual({ equipo: 'UPS' }));
    expect(one.result.current.response?.templateRef).toBe('ups_cdp_v1');
  });
});
