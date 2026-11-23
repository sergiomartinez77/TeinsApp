import {
  buildVisitListQuery,
  escapeLike,
  VISIT_BY_ID_SQL,
  visitTypesMatching,
} from '../services/visit.queries';
import {
  completeVisit,
  createVisit,
  startVisit,
  VISIT_MESSAGES,
  type VisitDatabase,
} from '../services/visit.service';
import { createVisitSchema } from '../validation';

jest.mock('@/utils/uuid.utils', () => ({ generateId: () => 'nuevo-id' }));

type Row = Record<string, unknown>;

/** Base de datos en memoria con lo mínimo que usa el servicio. */
function createDb(initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [String(row.id), { ...row }]));
  const statements: string[] = [];
  let failNext: Error | null = null;

  const db: VisitDatabase = {
    writeTransaction: async (callback) => {
      // Copia de trabajo: si la transacción falla, no se aplica nada.
      const draft = new Map([...rows].map(([id, row]) => [id, { ...row }]));
      const result = await callback({
        getOptional: async <T>(_sql: string, parameters: unknown[] = []) => {
          const row = draft.get(String(parameters[0]));
          return (row && row.technician_id === parameters[1] ? row : null) as T | null;
        },
        execute: async (sql, parameters = []) => {
          if (failNext) {
            const error = failNext;
            failNext = null;
            throw error;
          }
          statements.push(sql);
          if (sql.includes('INSERT INTO visits')) {
            const [id, technician_id, title, description, visit_type, address, created_at] =
              parameters;
            draft.set(String(id), {
              id,
              technician_id,
              title,
              description,
              visit_type,
              address,
              status: 'assigned',
              sync_status: 'pendingSync',
              created_at,
              updated_at: parameters[7],
            });
          } else {
            const [status, started_at, completed_at, updated_at, sync_status, id] = parameters;
            Object.assign(draft.get(String(id)) ?? {}, {
              status,
              started_at,
              completed_at,
              updated_at,
              sync_status,
            });
          }
        },
      });
      rows.clear();
      draft.forEach((row, id) => rows.set(id, row));
      return result;
    },
  };

  return {
    db,
    rows,
    statements,
    failNextWrite: (error: Error) => {
      failNext = error;
    },
  };
}

const TECH = { id: 'tech-1', role: 'technician' as const };
const NOW = new Date('2026-06-01T10:00:00.000Z');
const visitRow = (overrides: Row = {}): Row => ({
  id: 'v1',
  technician_id: 'tech-1',
  title: 'Visita',
  visit_type: 'general',
  status: 'assigned',
  sync_status: 'synced',
  created_at: '2026-05-30T08:00:00.000Z',
  started_at: null,
  completed_at: null,
  ...overrides,
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createVisitSchema', () => {
  it('exige título y tipo válidos', () => {
    const result = createVisitSchema.safeParse({
      title: '   ',
      visitType: 'otro',
      address: '',
      description: '',
    });
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);

    expect(messages).toEqual([
      'Escribe un título para la visita.',
      'Selecciona el tipo de visita.',
    ]);
  });

  it('recorta los textos y convierte los opcionales vacíos en null', () => {
    const result = createVisitSchema.safeParse({
      title: '  Inspección  ',
      visitType: 'ups',
      address: '   ',
      description: ' Revisar banco de baterías ',
    });

    expect(result.success && result.data).toEqual({
      title: 'Inspección',
      visitType: 'ups',
      address: null,
      description: 'Revisar banco de baterías',
    });
  });
});

describe('createVisit', () => {
  const input = {
    title: 'Inspección',
    visitType: 'energia' as const,
    address: null,
    description: null,
  };

  it('guarda la visita asignada al técnico con id generado en el dispositivo', async () => {
    const { db, rows } = createDb();

    const result = await createVisit(db, TECH, input, NOW);

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: 'nuevo-id',
        technicianId: 'tech-1',
        status: 'assigned',
        syncStatus: 'pendingSync',
      },
    });
    expect(rows.get('nuevo-id')).toMatchObject({
      technician_id: 'tech-1',
      title: 'Inspección',
      visit_type: 'energia',
      status: 'assigned',
      sync_status: 'pendingSync',
      created_at: '2026-06-01T10:00:00.000Z',
      updated_at: '2026-06-01T10:00:00.000Z',
    });
  });

  it('no permite crear visitas a un rol sin permiso', async () => {
    const { db, rows } = createDb();

    const result = await createVisit(db, { id: 'o1', role: 'office' }, input, NOW);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'unauthorized', message: VISIT_MESSAGES.cannotCreate },
    });
    expect(rows.size).toBe(0);
  });

  it('devuelve un error de datos locales si falla la escritura', async () => {
    const { db, failNextWrite } = createDb();
    failNextWrite(new Error('disco lleno'));

    const result = await createVisit(db, TECH, input, NOW);

    expect(result).toMatchObject({ ok: false, error: { kind: 'database' } });
  });
});

describe('startVisit / completeVisit', () => {
  it('inicia una visita asignada y registra la hora de inicio', async () => {
    const { db, rows } = createDb([visitRow()]);

    const result = await startVisit(db, 'tech-1', 'v1', NOW);

    expect(result).toMatchObject({ ok: true, data: { status: 'inProgress' } });
    expect(rows.get('v1')).toMatchObject({
      status: 'inProgress',
      started_at: '2026-06-01T10:00:00.000Z',
      completed_at: null,
      sync_status: 'pendingSync',
    });
  });

  it('finaliza una visita en progreso conservando la hora de inicio', async () => {
    const { db, rows } = createDb([
      visitRow({ status: 'inProgress', started_at: '2026-06-01T08:00:00.000Z' }),
    ]);

    const result = await completeVisit(db, 'tech-1', 'v1', NOW);

    expect(result.ok).toBe(true);
    expect(rows.get('v1')).toMatchObject({
      status: 'completed',
      started_at: '2026-06-01T08:00:00.000Z',
      completed_at: '2026-06-01T10:00:00.000Z',
    });
  });

  it('rechaza una transición inválida sin escribir nada', async () => {
    const { db, rows, statements } = createDb([visitRow()]);

    const result = await completeVisit(db, 'tech-1', 'v1', NOW);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_transition' } });
    expect(statements).toHaveLength(0);
    expect(rows.get('v1')).toMatchObject({ status: 'assigned', sync_status: 'synced' });
  });

  it('no permite iniciar dos veces la misma visita', async () => {
    const { db } = createDb([visitRow()]);

    expect((await startVisit(db, 'tech-1', 'v1', NOW)).ok).toBe(true);
    expect(await startVisit(db, 'tech-1', 'v1', NOW)).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
  });

  it('no encuentra visitas de otro técnico ni inexistentes', async () => {
    const { db, rows } = createDb([visitRow({ technician_id: 'otro' })]);

    for (const id of ['v1', 'no-existe']) {
      expect(await startVisit(db, 'tech-1', id, NOW)).toMatchObject({
        ok: false,
        error: { code: 'not_found', message: VISIT_MESSAGES.notFound },
      });
    }
    expect(rows.get('v1')).toMatchObject({ status: 'assigned' });
  });

  it('si falla la escritura no cambia el estado', async () => {
    const { db, rows, failNextWrite } = createDb([visitRow()]);
    failNextWrite(new Error('bloqueo'));

    const result = await startVisit(db, 'tech-1', 'v1', NOW);

    expect(result).toMatchObject({ ok: false, error: { kind: 'database' } });
    expect(rows.get('v1')).toMatchObject({ status: 'assigned' });
  });
});

describe('consultas del listado', () => {
  it('filtra siempre por técnico y ordena por fecha de creación', () => {
    const query = buildVisitListQuery('tech-1', { filter: 'all', search: '', limit: 21 });

    expect(query.sql).toMatch(/^SELECT visits\.\*, \(SELECT coalesce\(/);
    expect(query.sql).toMatch(/AS technician_name FROM visits/);
    expect(query.sql).toMatch(/WHERE technician_id = \? ORDER BY created_at DESC LIMIT \?$/);
    expect(query.parameters).toEqual(['tech-1', 21]);
    expect(VISIT_BY_ID_SQL).toMatch(/id = \? AND technician_id = \?/);
  });

  it('aplica la condición de cada pestaña', () => {
    const sql = (filter: 'inProgress' | 'assigned' | 'completed') =>
      buildVisitListQuery('t', { filter, search: '', limit: 10 }).sql;

    expect(sql('inProgress')).toContain("status = 'inProgress'");
    expect(sql('assigned')).toContain("status = 'assigned'");
    expect(sql('completed')).toContain("status IN ('completed', 'pendingReview', 'synced')");
  });

  it('busca en título, cliente, dirección y tipo, usando parámetros', () => {
    const query = buildVisitListQuery('t', { filter: 'assigned', search: '  almacen ', limit: 5 });

    expect(query.sql).toContain(
      "(title LIKE ? ESCAPE '\\' OR client_name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' OR visit_type LIKE ? ESCAPE '\\')",
    );
    expect(query.parameters).toEqual(['t', '%almacen%', '%almacen%', '%almacen%', '%almacen%', 5]);
  });

  it('con letras acentuadas busca también la variante en mayúsculas', () => {
    const query = buildVisitListQuery('t', { filter: 'all', search: 'éxito', limit: 5 });

    expect(query.sql).toContain("(title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR");
    expect(query.parameters).toEqual([
      't',
      ...['title', 'client_name', 'address', 'visit_type'].flatMap(() => ['%éxito%', '%ÉXITO%']),
      5,
    ]);
    // "ÉXITO" escrito en mayúsculas encuentra el registro guardado como "éxito".
    expect(
      buildVisitListQuery('t', { filter: 'all', search: 'ÉXITO', limit: 5 }).parameters,
    ).toContain('%éxito%');
  });

  it('encuentra por el nombre visible del tipo de visita', () => {
    expect(visitTypesMatching('ENERGÍA')).toEqual(['energia']);
    expect(visitTypesMatching('inspección')).toEqual(['infraestructura', 'energia', 'datos']);
    expect(visitTypesMatching('zzz')).toEqual([]);

    const query = buildVisitListQuery('t', { filter: 'all', search: 'Energía', limit: 5 });
    expect(query.sql).toContain('OR visit_type IN (?)');
    expect(query.parameters).toContain('energia');
  });

  it('trata los comodines escritos por el usuario como texto literal', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
    const query = buildVisitListQuery('t', { filter: 'all', search: "100%'; DROP", limit: 5 });

    expect(query.sql).not.toContain('DROP');
    expect(query.parameters[1]).toBe("%100\\%'; DROP%");
  });
});
