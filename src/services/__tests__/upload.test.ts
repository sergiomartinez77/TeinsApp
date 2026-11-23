import { CrudEntry, UpdateType } from '@powersync/react-native';

import {
  isFatalRemoteError,
  RetryableUploadError,
  toRemoteRow,
  uploadNextTransaction,
  type RemoteResult,
  type RemoteWriter,
  type RowData,
  type SyncIssue,
} from '../powersync/upload';

type Call =
  | { kind: 'upsert'; table: string; row: RowData }
  | { kind: 'update'; table: string; id: string; changes: RowData }
  | { kind: 'remove'; table: string; id: string };

function createRemote(respond: (call: Call) => RemoteResult = () => ({ error: null })) {
  const calls: Call[] = [];
  const run = async (call: Call) => {
    calls.push(call);
    return respond(call);
  };
  const remote: RemoteWriter = {
    upsert: (table, row) => run({ kind: 'upsert', table, row }),
    update: (table, id, changes) => run({ kind: 'update', table, id, changes }),
    remove: (table, id) => run({ kind: 'remove', table, id }),
  };
  return { remote, calls };
}

function createSource(entries: CrudEntry[] | null) {
  const complete = jest.fn(async () => undefined);
  return {
    complete,
    source: {
      getNextCrudTransaction: async () => (entries ? { crud: entries, complete } : null),
    },
  };
}

let nextOpId = 1;
const entry = (op: UpdateType, table: string, id: string, data?: RowData) =>
  new CrudEntry(nextOpId++, op, table, id, 1, data);

describe('toRemoteRow', () => {
  it('convierte el JSON en texto a objeto para columnas JSONB', () => {
    const row = toRemoteRow('form_responses', {
      visit_id: 'v1',
      responses: '{"ubicacion":"Bodega","requiere":true}',
    });
    expect(row.responses).toEqual({ ubicacion: 'Bodega', requiere: true });

    const annotation = toRemoteRow('annotations', { elements: '[{"id":"e1"}]' });
    expect(annotation.elements).toEqual([{ id: 'e1' }]);
  });

  it('convierte 1/0 a booleano', () => {
    expect(toRemoteRow('form_responses', { is_complete: 1 }).is_complete).toBe(true);
    expect(toRemoteRow('form_responses', { is_complete: 0 }).is_complete).toBe(false);
  });

  it('marca como sincronizado lo que se sube', () => {
    expect(toRemoteRow('visits', { sync_status: 'pendingSync' }).sync_status).toBe('synced');
    expect(toRemoteRow('visit_materials', { sync_status: 'local' }).sync_status).toBe('synced');
    expect(toRemoteRow('visits', { sync_status: 'conflict' }).sync_status).toBe('conflict');
  });

  it('adapta las figuras guardadas: JSON a objeto y sync_status a synced', () => {
    const figure = toRemoteRow('annotation_figures', {
      technician_id: 't1',
      name: 'Rack 42U',
      elements: '[{"id":"e1","type":"rect"}]',
      width: 60,
      height: 200,
      sync_status: 'local',
    });
    expect(figure).toEqual({
      technician_id: 't1',
      name: 'Rack 42U',
      elements: [{ id: 'e1', type: 'rect' }],
      width: 60,
      height: 200,
      sync_status: 'synced',
    });
  });

  it('no toca el estado de subida propio de las fotos', () => {
    expect(toRemoteRow('photos', { sync_status: 'local' }).sync_status).toBe('local');
  });

  it('no modifica el objeto original ni rompe con JSON inválido', () => {
    const original = { responses: '{no es json', sync_status: 'pendingSync' };
    const row = toRemoteRow('form_responses', original);

    expect(row.responses).toBe('{no es json');
    expect(original.sync_status).toBe('pendingSync');
  });
});

describe('isFatalRemoteError', () => {
  it('distingue rechazos definitivos de errores temporales', () => {
    expect(isFatalRemoteError({ code: '23505', message: 'duplicado' })).toBe(true);
    expect(isFatalRemoteError({ code: '22P02', message: 'dato inválido' })).toBe(true);
    expect(isFatalRemoteError({ code: '42501', message: 'sin permiso' })).toBe(true);
    expect(isFatalRemoteError({ code: '57014', message: 'timeout' })).toBe(false);
    expect(isFatalRemoteError({ message: 'Network request failed' })).toBe(false);
  });
});

describe('uploadNextTransaction', () => {
  const noIssues = async () => undefined;

  it('sube y borra planos y figuras guardadas', async () => {
    const { remote, calls } = createRemote();
    const { source, complete } = createSource([
      entry(UpdateType.PUT, 'annotation_figures', 'f1', {
        name: 'Rack',
        elements: '[]',
        sync_status: 'local',
      }),
      entry(UpdateType.PATCH, 'annotation_figures', 'f1', { name: 'Rack 42U' }),
      entry(UpdateType.DELETE, 'annotation_figures', 'f1'),
      entry(UpdateType.DELETE, 'annotations', 'a1'),
    ]);

    const outcome = await uploadNextTransaction(source, remote, noIssues);

    expect(outcome).toEqual({ uploaded: 4, issues: [] });
    expect(calls).toEqual([
      {
        kind: 'upsert',
        table: 'annotation_figures',
        row: { id: 'f1', name: 'Rack', elements: [], sync_status: 'synced' },
      },
      { kind: 'update', table: 'annotation_figures', id: 'f1', changes: { name: 'Rack 42U' } },
      { kind: 'remove', table: 'annotation_figures', id: 'f1' },
      { kind: 'remove', table: 'annotations', id: 'a1' },
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('no hace nada si no hay cambios pendientes', async () => {
    const { remote, calls } = createRemote();
    const { source } = createSource(null);

    expect(await uploadNextTransaction(source, remote, noIssues)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('sube altas, cambios y bajas en orden y confirma la transacción', async () => {
    const { remote, calls } = createRemote();
    const { source, complete } = createSource([
      entry(UpdateType.PUT, 'visits', 'v1', { title: 'Visita', sync_status: 'pendingSync' }),
      entry(UpdateType.PATCH, 'visits', 'v1', { status: 'inProgress' }),
      entry(UpdateType.DELETE, 'visit_materials', 'm1'),
    ]);

    const outcome = await uploadNextTransaction(source, remote, noIssues);

    expect(outcome).toEqual({ uploaded: 3, issues: [] });
    expect(calls).toEqual([
      {
        kind: 'upsert',
        table: 'visits',
        row: { id: 'v1', title: 'Visita', sync_status: 'synced' },
      },
      { kind: 'update', table: 'visits', id: 'v1', changes: { status: 'inProgress' } },
      { kind: 'remove', table: 'visit_materials', id: 'm1' },
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('ante un error temporal no confirma: los cambios siguen en la cola', async () => {
    const { remote } = createRemote(() => ({ error: { message: 'Network request failed' } }));
    const { source, complete } = createSource([
      entry(UpdateType.PUT, 'visits', 'v1', { title: 'Visita' }),
    ]);
    const recordIssue = jest.fn(noIssues);

    await expect(uploadNextTransaction(source, remote, recordIssue)).rejects.toBeInstanceOf(
      RetryableUploadError,
    );
    expect(complete).not.toHaveBeenCalled();
    expect(recordIssue).not.toHaveBeenCalled();
  });

  it('registra los rechazos definitivos y sigue con el resto', async () => {
    const { remote, calls } = createRemote((call) =>
      call.table === 'visit_materials'
        ? { error: { code: '23514', message: 'chk_quantity_positive' } }
        : { error: null },
    );
    const { source, complete } = createSource([
      entry(UpdateType.PUT, 'visit_materials', 'm1', { quantity: -1 }),
      entry(UpdateType.PUT, 'visits', 'v1', { title: 'Visita' }),
    ]);
    const recorded: SyncIssue[] = [];

    const outcome = await uploadNextTransaction(source, remote, async (issue) => {
      recorded.push(issue);
    });

    expect(calls).toHaveLength(2);
    expect(outcome?.uploaded).toBe(1);
    expect(recorded).toEqual([
      {
        table: 'visit_materials',
        rowId: 'm1',
        operation: UpdateType.PUT,
        code: '23514',
        message: 'chk_quantity_positive',
        payload: { quantity: -1 },
      },
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('no envía cambios sobre tablas de solo lectura y los deja registrados', async () => {
    const { remote, calls } = createRemote();
    const { source, complete } = createSource([
      entry(UpdateType.PUT, 'material_catalog', 'c1', { code: 'X' }),
    ]);
    const recorded: SyncIssue[] = [];

    await uploadNextTransaction(source, remote, async (issue) => {
      recorded.push(issue);
    });

    expect(calls).toHaveLength(0);
    expect(recorded[0]?.code).toBe('READ_ONLY_TABLE');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('sube los movimientos de bodega y el mínimo del catálogo; nunca material_stock', async () => {
    const { remote, calls } = createRemote();
    const { source, complete } = createSource([
      entry(UpdateType.PUT, 'material_stock_movements', 'mv1', {
        material_id: 'm1',
        kind: 'purchase',
        quantity: 10,
        sync_status: 'pendingSync',
      }),
      entry(UpdateType.PATCH, 'material_catalog', 'm1', { min_stock: 5 }),
      entry(UpdateType.PATCH, 'material_catalog', 'm1', { name: 'Otro nombre' }),
      entry(UpdateType.PATCH, 'material_catalog', 'm1', {}),
      entry(UpdateType.DELETE, 'material_catalog', 'm1'),
      entry(UpdateType.PUT, 'material_stock', 'm1', { on_hand: 999 }),
    ]);
    const recorded: SyncIssue[] = [];

    const outcome = await uploadNextTransaction(source, remote, async (issue) => {
      recorded.push(issue);
    });

    expect(outcome?.uploaded).toBe(2);
    expect(calls).toEqual([
      {
        kind: 'upsert',
        table: 'material_stock_movements',
        row: {
          id: 'mv1',
          material_id: 'm1',
          kind: 'purchase',
          quantity: 10,
          sync_status: 'synced',
        },
      },
      { kind: 'update', table: 'material_catalog', id: 'm1', changes: { min_stock: 5 } },
    ]);
    expect(recorded.map((issue) => [issue.table, issue.operation, issue.code])).toEqual([
      ['material_catalog', UpdateType.PATCH, 'READ_ONLY_TABLE'],
      ['material_catalog', UpdateType.PATCH, 'READ_ONLY_TABLE'],
      ['material_catalog', UpdateType.DELETE, 'READ_ONLY_TABLE'],
      ['material_stock', UpdateType.PUT, 'READ_ONLY_TABLE'],
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('un movimiento rechazado por la RLS (técnico) queda registrado', async () => {
    const { remote } = createRemote(() => ({
      error: { code: '42501', message: 'new row violates row-level security policy' },
    }));
    const { source } = createSource([
      entry(UpdateType.PUT, 'material_stock_movements', 'mv1', { kind: 'purchase' }),
    ]);
    const recorded: SyncIssue[] = [];

    await uploadNextTransaction(source, remote, async (issue) => {
      recorded.push(issue);
    });

    expect(recorded[0]).toMatchObject({ table: 'material_stock_movements', code: '42501' });
  });

  it('convierte is_active del catálogo a booleano', () => {
    expect(toRemoteRow('material_catalog', { is_active: 1 }).is_active).toBe(true);
  });

  it('si no puede guardar la incidencia, no confirma la transacción', async () => {
    const { remote } = createRemote(() => ({ error: { code: '42501', message: 'rls' } }));
    const { source, complete } = createSource([
      entry(UpdateType.PUT, 'visits', 'v1', { title: 'Visita' }),
    ]);

    await expect(
      uploadNextTransaction(source, remote, async () => {
        throw new Error('disco lleno');
      }),
    ).rejects.toThrow('disco lleno');
    expect(complete).not.toHaveBeenCalled();
  });
});
