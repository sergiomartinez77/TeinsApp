import { TEMPLATE_KEY } from '@/models/form.model';

import {
  completeFormResponse,
  RESPONSE_MESSAGES,
  responseFromRow,
  saveFormResponse,
} from '../services/response.service';

import { createDb, visitRow, type Row } from './fake-form-db';
let mockIdCounter = 0;
jest.mock('@/utils/uuid.utils', () => ({
  generateId: () => {
    mockIdCounter += 1;
    return `respuesta-${mockIdCounter}`;
  },
}));

const DB_TEMPLATE = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  version: 3,
  source: 'database' as const,
};
const ASSET_TEMPLATE = { id: 'ups_cdp_v1', version: 1, source: 'asset' as const };
const T1 = new Date('2026-06-01T10:00:00.000Z');
const T2 = new Date('2026-06-01T10:05:00.000Z');

const json = (row: Row | undefined) => JSON.parse(String(row?.responses)) as Row;

beforeEach(() => {
  mockIdCounter = 0;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('saveFormResponse', () => {
  it('el primer guardado inserta la fila pendiente de sincronizar', async () => {
    const { db, rows } = createDb();

    const result = await saveFormResponse(
      db,
      { visitId: 'v1', template: DB_TEMPLATE, values: { cliente: 'ABC', cantidad: 2 } },
      T1,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { id: 'respuesta-1', visitId: 'v1', isComplete: false, syncStatus: 'pendingSync' },
    });
    expect(rows.get('respuesta-1')).toMatchObject({
      visit_id: 'v1',
      template_id: DB_TEMPLATE.id,
      template_version: 3,
      sync_status: 'pendingSync',
      is_complete: 0,
      created_at: '2026-06-01T10:00:00.000Z',
      updated_at: '2026-06-01T10:00:00.000Z',
      completed_at: null,
    });
    expect(json(rows.get('respuesta-1'))).toEqual({ cliente: 'ABC', cantidad: 2 });
  });

  it('el segundo guardado actualiza la misma fila (nunca duplica)', async () => {
    const { db, rows, statements } = createDb();
    const input = { visitId: 'v1', template: DB_TEMPLATE, values: { cliente: 'ABC' } };

    await saveFormResponse(db, input, T1);
    const second = await saveFormResponse(db, { ...input, values: { cliente: 'XYZ' } }, T2);

    expect(rows.size).toBe(1);
    expect(statements.filter((sql) => sql.includes('INSERT'))).toHaveLength(1);
    expect(statements.at(-1)).toContain('UPDATE form_responses');
    expect(second).toMatchObject({ ok: true, data: { id: 'respuesta-1' } });
    expect(rows.get('respuesta-1')).toMatchObject({
      created_at: '2026-06-01T10:00:00.000Z',
      updated_at: '2026-06-01T10:05:00.000Z',
      sync_status: 'pendingSync',
    });
    expect(json(rows.get('respuesta-1'))).toEqual({ cliente: 'XYZ' });
  });

  it('con plantilla del asset deja template_id nulo y guarda la clave reservada', async () => {
    const { db, rows } = createDb();

    const result = await saveFormResponse(
      db,
      { visitId: 'v1', template: ASSET_TEMPLATE, values: { equipo: 'UPS 10 kVA' } },
      T1,
    );

    expect(rows.get('respuesta-1')).toMatchObject({ template_id: null, template_version: 1 });
    expect(json(rows.get('respuesta-1'))).toEqual({
      equipo: 'UPS 10 kVA',
      [TEMPLATE_KEY]: 'ups_cdp_v1',
    });
    // La clave reservada no aparece entre los valores del formulario.
    expect(result).toMatchObject({
      ok: true,
      data: { templateId: null, templateKey: 'ups_cdp_v1', values: { equipo: 'UPS 10 kVA' } },
    });
  });

  it('con plantilla de la base guarda template_id y no añade la clave reservada', async () => {
    const { db, rows } = createDb();

    await saveFormResponse(
      db,
      { visitId: 'v1', template: DB_TEMPLATE, values: { [TEMPLATE_KEY]: 'intruso', a: 'b' } },
      T1,
    );

    expect(rows.get('respuesta-1')?.template_id).toBe(DB_TEMPLATE.id);
    expect(json(rows.get('respuesta-1'))).toEqual({ a: 'b' });
  });

  it('si falla la escritura devuelve un error y no deja datos a medias', async () => {
    const { db, rows, failNextWrite } = createDb();
    failNextWrite(new Error('disco lleno'));

    const result = await saveFormResponse(
      db,
      { visitId: 'v1', template: DB_TEMPLATE, values: { a: 'b' } },
      T1,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: 'database' } });
    expect(rows.size).toBe(0);
  });
});

describe('completeFormResponse', () => {
  it('marca is_complete y completed_at', async () => {
    const { db, rows } = createDb();
    const input = { visitId: 'v1', template: DB_TEMPLATE, values: { a: 'b' } };
    await saveFormResponse(db, input, T1);

    const result = await completeFormResponse(db, input, T2);

    expect(result).toMatchObject({
      ok: true,
      data: { isComplete: true, completedAt: '2026-06-01T10:05:00.000Z' },
    });
    expect(rows.get('respuesta-1')).toMatchObject({
      is_complete: 1,
      completed_at: '2026-06-01T10:05:00.000Z',
      updated_at: '2026-06-01T10:05:00.000Z',
      sync_status: 'pendingSync',
    });
  });

  it('puede completar en el primer guardado', async () => {
    const { db, rows } = createDb();

    await completeFormResponse(db, { visitId: 'v1', template: DB_TEMPLATE, values: {} }, T1);

    expect(rows.get('respuesta-1')).toMatchObject({
      is_complete: 1,
      completed_at: '2026-06-01T10:00:00.000Z',
    });
  });

  it('no modifica un formulario ya completado', async () => {
    const { db, rows } = createDb();
    const input = { visitId: 'v1', template: DB_TEMPLATE, values: { a: 'b' } };
    await completeFormResponse(db, input, T1);

    const result = await saveFormResponse(db, { ...input, values: { a: 'cambio' } }, T2);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: RESPONSE_MESSAGES.alreadyComplete },
    });
    expect(json(rows.get('respuesta-1'))).toEqual({ a: 'b' });
  });

  it('si falla al completar, la fila sigue sin completar', async () => {
    const { db, rows, failNextWrite } = createDb();
    const input = { visitId: 'v1', template: DB_TEMPLATE, values: { a: 'b' } };
    await saveFormResponse(db, input, T1);
    failNextWrite(new Error('bloqueo'));

    const result = await completeFormResponse(db, input, T2);

    expect(result).toMatchObject({ ok: false, error: { kind: 'database' } });
    expect(rows.get('respuesta-1')).toMatchObject({ is_complete: 0, completed_at: null });
  });
});

describe('registro de la plantilla en la visita', () => {
  it('con plantilla de la base, el primer guardado registra id y versión en la visita', async () => {
    const { db, visits } = createDb();

    await saveFormResponse(db, { visitId: 'v1', template: DB_TEMPLATE, values: {} }, T1);

    expect(visits.get('v1')).toMatchObject({
      form_template_id: DB_TEMPLATE.id,
      form_template_version: 3,
      sync_status: 'pendingSync',
      updated_at: '2026-06-01T10:00:00.000Z',
    });
  });

  it('con plantilla del asset solo registra la versión (form_template_id sigue nulo)', async () => {
    const { db, visits } = createDb();

    await saveFormResponse(db, { visitId: 'v1', template: ASSET_TEMPLATE, values: {} }, T1);

    expect(visits.get('v1')).toMatchObject({
      form_template_id: null,
      form_template_version: 1,
      sync_status: 'pendingSync',
      updated_at: '2026-06-01T10:00:00.000Z',
    });
  });

  it('los guardados posteriores no vuelven a tocar la visita', async () => {
    const { db, visits, statements } = createDb();
    const input = { visitId: 'v1', template: DB_TEMPLATE, values: { a: 'b' } };
    await saveFormResponse(db, input, T1);

    await saveFormResponse(db, input, T2);
    await completeFormResponse(db, input, T2);

    expect(statements.filter((sql) => sql.includes('UPDATE visits'))).toHaveLength(1);
    expect(visits.get('v1')?.updated_at).toBe('2026-06-01T10:00:00.000Z');
  });

  it('si falla la actualización de la visita no queda la respuesta a medias', async () => {
    const { db, rows, visits, failNextWrite } = createDb();
    failNextWrite(new Error('bloqueo'), 1);

    const result = await saveFormResponse(
      db,
      { visitId: 'v1', template: DB_TEMPLATE, values: {} },
      T1,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: 'database' } });
    expect(rows.size).toBe(0);
    expect(visits.get('v1')).toMatchObject({ form_template_id: null, sync_status: 'synced' });
  });
});

describe('visita cerrada', () => {
  it.each(['completed', 'pendingReview', 'synced'])(
    'no guarda ni completa si la visita está %s',
    async (status) => {
      const { db, rows, visits, statements } = createDb({ visits: [visitRow({ status })] });
      const input = { visitId: 'v1', template: DB_TEMPLATE, values: { a: 'b' } };

      for (const write of [saveFormResponse, completeFormResponse]) {
        expect(await write(db, input, T1)).toMatchObject({
          ok: false,
          error: { kind: 'validation', message: RESPONSE_MESSAGES.visitClosed },
        });
      }
      expect(statements).toHaveLength(0);
      expect(rows.size).toBe(0);
      expect(visits.get('v1')).toMatchObject({ sync_status: 'synced' });
    },
  );

  it('no modifica la respuesta existente de una visita cerrada', async () => {
    const existing = {
      id: 'r1',
      visit_id: 'v1',
      responses: '{"a":"b"}',
      is_complete: 0,
      sync_status: 'synced',
    };
    const { db, rows, statements } = createDb({
      visits: [visitRow({ status: 'completed' })],
      responses: [existing],
    });

    const result = await saveFormResponse(
      db,
      { visitId: 'v1', template: DB_TEMPLATE, values: { a: 'cambio' } },
      T1,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'visit_closed' } });
    expect(statements).toHaveLength(0);
    expect(rows.get('r1')).toEqual(existing);
  });

  it('acepta visitas asignadas y no escribe si la visita no existe', async () => {
    const assigned = createDb({ visits: [visitRow({ status: 'assigned' })] });
    expect(
      (
        await saveFormResponse(
          assigned.db,
          { visitId: 'v1', template: DB_TEMPLATE, values: {} },
          T1,
        )
      ).ok,
    ).toBe(true);

    const missing = createDb({ visits: [] });
    expect(
      await saveFormResponse(missing.db, { visitId: 'v1', template: DB_TEMPLATE, values: {} }, T1),
    ).toMatchObject({ ok: false, error: { kind: 'validation', code: 'not_found' } });
    expect(missing.statements).toHaveLength(0);
  });
});

describe('responseFromRow', () => {
  it('interpreta el JSON y tolera respuestas dañadas', () => {
    expect(
      responseFromRow({ id: 'r', visit_id: 'v', responses: '{roto', is_complete: 1 }),
    ).toMatchObject({ values: {}, templateKey: null, isComplete: true });
  });
});
