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
