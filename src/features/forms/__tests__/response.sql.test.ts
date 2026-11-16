import { responseFromRow, TEMPLATE_KEY } from '@/models/form.model';
import { responseRow, TECH_A, TECH_B, templateRow, visitRow } from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import {
  completeFormResponse,
  RESPONSE_BY_VISIT_SQL,
  RESPONSE_MESSAGES,
  saveFormResponse,
} from '../services/response.service';
import { buildTemplateCatalog, templateForVisitType } from '../services/template.service';

/** Consultas y escrituras de formularios ejecutadas contra SQLite real. */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const T1 = new Date('2026-06-10T12:00:00.000Z');
const T2 = new Date('2026-06-10T12:05:00.000Z');
const DB_TEMPLATE = { id: 'tpl-db-1', version: 3, source: 'database' as const };
const ASSET_TEMPLATE = { id: 'ups_cdp_v1', version: 1, source: 'asset' as const };

let db: TestDatabase;

beforeEach(() => {
  resetIds('respuesta');
  db = createTestDatabase();
  db.insert('visits', [
    visitRow({ id: 'v1', status: 'inProgress' }),
    visitRow({ id: 'v-asset', status: 'assigned', visit_type: 'ups' }),
    visitRow({ id: 'v-cerrada', status: 'completed' }),
    visitRow({ id: 'v-ajena', technician_id: TECH_B, status: 'inProgress' }),
  ]);
});

const visit = (id: string) => db.get<Row>('SELECT * FROM visits WHERE id = ?', [id]);

describe('RESPONSE_BY_VISIT_SQL', () => {
  it('devuelve la respuesta más antigua de la visita', async () => {
    db.insert('form_responses', [
      responseRow({ id: 'r-nueva', created_at: '2026-06-09T00:00:00.000Z' }),
      responseRow({ id: 'r-vieja', created_at: '2026-06-01T00:00:00.000Z' }),
      responseRow({ id: 'r-otra', visit_id: 'v-cerrada' }),
    ]);
    const rows = await db.getAll<Row>(RESPONSE_BY_VISIT_SQL, ['v1']);
    expect(rows.map((row) => row.id)).toEqual(['r-vieja']);
    expect(await db.getAll(RESPONSE_BY_VISIT_SQL, ['sin-respuesta'])).toEqual([]);
  });
});

describe('plantillas (SELECT * FROM form_templates)', () => {
  it('el catálogo usa la versión activa más alta de la base y el asset para los demás tipos', async () => {
    db.insert('form_templates', [
      templateRow({ id: 'tpl-v2', version: 2 }),
      templateRow({ id: 'tpl-v3', version: 3 }),
      templateRow({ id: 'tpl-inactiva', version: 9, is_active: 0 }),
      templateRow({ id: 'tpl-rota', sections_json: '{no es json' }),
    ]);
    const rows = await db.getAll<Row>('SELECT * FROM form_templates');
    const catalog = buildTemplateCatalog(rows);

    expect(catalog.database.map((template) => template.id).sort()).toEqual([
      'tpl-inactiva',
      'tpl-v2',
      'tpl-v3',
    ]);
    expect(templateForVisitType(catalog, 'general')?.id).toBe('tpl-v3');
    expect(templateForVisitType(catalog, 'ups')?.source).toBe('asset');
  });
});

describe('response.service contra SQLite real', () => {
  it('el primer guardado crea la respuesta y registra la plantilla y su versión en la visita', async () => {
    const result = await saveFormResponse(
      db,
      TECH_A,
      { visitId: 'v1', template: DB_TEMPLATE, values: { f1: 'Hola', cantidad: 2 } },
      T1,
    );

    expect(result.ok).toBe(true);
    const stored = await db.get<Row>(RESPONSE_BY_VISIT_SQL, ['v1']);
    expect(stored).toMatchObject({
      id: 'respuesta-1',
      template_id: 'tpl-db-1',
      template_version: 3,
      is_complete: 0,
      sync_status: 'pendingSync',
      completed_at: null,
    });
    expect(responseFromRow(stored).values).toEqual({ f1: 'Hola', cantidad: 2 });
    expect(await visit('v1')).toMatchObject({
      form_template_id: 'tpl-db-1',
      form_template_version: 3,
      sync_status: 'pendingSync',
      updated_at: T1.toISOString(),
    });
  });

  it('con plantilla de respaldo guarda su id en el JSON y deja form_template_id en NULL', async () => {
    await saveFormResponse(
      db,
      TECH_A,
      { visitId: 'v-asset', template: ASSET_TEMPLATE, values: { equipo: 'UPS 10kVA' } },
      T1,
    );

    const stored = await db.get<Row>(RESPONSE_BY_VISIT_SQL, ['v-asset']);
    expect(stored.template_id).toBeNull();
    expect(JSON.parse(String(stored.responses))).toEqual({
      equipo: 'UPS 10kVA',
      [TEMPLATE_KEY]: 'ups_cdp_v1',
    });
    expect(await visit('v-asset')).toMatchObject({
      form_template_id: null,
      form_template_version: 1,
    });
  });

  it('los guardados siguientes actualizan la misma fila; completar la cierra', async () => {
    const input = { visitId: 'v1', template: DB_TEMPLATE, values: { f1: 'uno' } };
    await saveFormResponse(db, TECH_A, input, T1);
    await saveFormResponse(db, TECH_A, { ...input, values: { f1: 'dos' } }, T2);
    expect(db.rows('form_responses')).toHaveLength(1);

    const completed = await completeFormResponse(
      db,
      TECH_A,
      { ...input, values: { f1: 'tres' } },
      T2,
    );
    expect(completed.ok && completed.data.isComplete).toBe(true);
    expect(await db.get<Row>(RESPONSE_BY_VISIT_SQL, ['v1'])).toMatchObject({
      is_complete: 1,
      completed_at: T2.toISOString(),
      created_at: T1.toISOString(),
    });

    const after = await saveFormResponse(db, TECH_A, { ...input, values: { f1: 'cuatro' } }, T2);
    expect(!after.ok && after.error.message).toBe(RESPONSE_MESSAGES.alreadyComplete);
    expect(responseFromRow(await db.get<Row>(RESPONSE_BY_VISIT_SQL, ['v1'])).values).toEqual({
      f1: 'tres',
    });
  });

  it('no escribe en una visita cerrada', async () => {
    const result = await saveFormResponse(
      db,
      TECH_A,
      { visitId: 'v-cerrada', template: DB_TEMPLATE, values: {} },
      T1,
    );
    expect(!result.ok && result.error.message).toBe(RESPONSE_MESSAGES.visitClosed);
    expect(db.rows('form_responses')).toEqual([]);
  });

  it('no escribe en la visita de otro técnico (ni toca esa visita)', async () => {
    const before = await visit('v-ajena');
    for (const write of [saveFormResponse, completeFormResponse]) {
      const result = await write(
        db,
        TECH_A,
        { visitId: 'v-ajena', template: DB_TEMPLATE, values: { f1: 'intruso' } },
        T1,
      );
      expect(!result.ok && result.error.message).toBe(RESPONSE_MESSAGES.visitNotFound);
    }
    expect(db.rows('form_responses')).toEqual([]);
    expect(await visit('v-ajena')).toEqual(before);
  });

  it('si falla la actualización de la visita no queda la respuesta a medias (ROLLBACK real)', async () => {
    db.raw.exec(`CREATE TRIGGER fallo BEFORE UPDATE ON visits
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);
    const before = await visit('v1');

    const result = await saveFormResponse(
      db,
      TECH_A,
      { visitId: 'v1', template: DB_TEMPLATE, values: { f1: 'x' } },
      T1,
    );

    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('form_responses')).toEqual([]);
    expect(await visit('v1')).toEqual(before);
  });
});
