import { TECH_A, TECH_B, ids, visitRow } from '@/test-utils/fixtures';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';
import { visitFromRow } from '@/models/visit.model';

import {
  buildVisitListQuery,
  IN_PROGRESS_VISITS_SQL,
  VISIT_BY_ID_SQL,
  VISIT_STATS_SQL,
  visitStatsFromRow,
  type VisitFilter,
} from '../services/visit.queries';
import { completeVisit, createVisit, startVisit, VISIT_MESSAGES } from '../services/visit.service';

/**
 * Consultas y escrituras de visitas ejecutadas contra SQLite real
 * (no se compara el texto del SQL: se comprueban los resultados).
 */

jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-10T12:00:00.000Z');

/** Visitas variadas de dos técnicos. */
const VISITS: Row[] = [
  visitRow({
    id: 'a-asignada',
    title: 'Revisión UPS sede norte',
    client_name: 'Éxito Comercial',
    address: 'Av. Siempre Viva 742',
    visit_type: 'ups',
    status: 'assigned',
    sync_status: 'synced',
    created_at: '2026-06-01T08:00:00.000Z',
  }),
  visitRow({
    id: 'a-progreso-1',
    title: 'Cableado 100% certificado',
    client_name: 'Datos_SA',
    visit_type: 'datos',
    status: 'inProgress',
    sync_status: 'pendingSync',
    created_at: '2026-06-02T08:00:00.000Z',
    started_at: '2026-06-05T08:00:00.000Z',
  }),
  visitRow({
    id: 'a-progreso-2',
    title: 'Inspección tablero',
    client_name: 'Industrias XYZ',
    visit_type: 'energia',
    status: 'inProgress',
    sync_status: 'local',
    created_at: '2026-06-03T08:00:00.000Z',
    started_at: null,
  }),
  visitRow({
    id: 'a-completada',
    title: 'Mantenimiento general',
    client_name: 'Cañerías del Sur',
    address: 'Calle Ñandú 5',
    visit_type: 'general',
    status: 'completed',
    sync_status: 'syncError',
    created_at: '2026-06-04T08:00:00.000Z',
  }),
  visitRow({
    id: 'a-revision',
    title: 'Revisión anual',
    status: 'pendingReview',
    sync_status: 'synced',
    created_at: '2026-06-06T08:00:00.000Z',
  }),
  visitRow({
    id: 'a-sincronizada',
    title: 'Visita cerrada',
    status: 'synced',
    sync_status: 'synced',
    created_at: '2026-06-07T08:00:00.000Z',
  }),
  // Otro técnico: nunca debe aparecer en las consultas del técnico A.
  visitRow({
    id: 'b-progreso',
    technician_id: TECH_B,
    title: 'Revisión UPS sede norte',
    client_name: 'Éxito Comercial',
    visit_type: 'ups',
    status: 'inProgress',
    sync_status: 'pendingSync',
    created_at: '2026-06-08T08:00:00.000Z',
    started_at: '2026-06-09T08:00:00.000Z',
  }),
];

let db: TestDatabase;

beforeEach(() => {
  resetIds('visita');
  db = createTestDatabase();
  db.insert('visits', VISITS);
});

const list = async (filter: VisitFilter, search = '', limit = 50, technician = TECH_A) => {
  const query = buildVisitListQuery(technician, { filter, search, limit });
  return ids(await db.getAll<Row>(query.sql, query.parameters));
};

describe('VISIT_STATS_SQL (dashboard)', () => {
  it('cuenta por estado y por sincronización solo las visitas del técnico', async () => {
    const row = await db.get<Row>(VISIT_STATS_SQL, [TECH_A]);
    expect(visitStatsFromRow(row)).toEqual({
      assigned: 1,
      inProgress: 2,
      // completed + pendingReview + synced
      completed: 3,
      // pendingSync + local + syncError
      pendingSync: 3,
    });
  });

  it('devuelve ceros (no NULL) si el técnico no tiene visitas', async () => {
    const row = await db.get<Row>(VISIT_STATS_SQL, ['sin-visitas']);
    expect(row).toEqual({ assigned: 0, in_progress: 0, completed: 0, pending_sync: 0 });
  });
});

describe('IN_PROGRESS_VISITS_SQL', () => {
  it('lista las en progreso del técnico, la iniciada más recientemente primero', async () => {
    const rows = await db.getAll<Row>(IN_PROGRESS_VISITS_SQL, [TECH_A, 3]);
    // a-progreso-1 empezó el 5; a-progreso-2 no tiene inicio y usa su creación (día 3).
    expect(ids(rows)).toEqual(['a-progreso-1', 'a-progreso-2']);
  });

  it('respeta el límite', async () => {
    expect(ids(await db.getAll<Row>(IN_PROGRESS_VISITS_SQL, [TECH_A, 1]))).toEqual([
      'a-progreso-1',
    ]);
  });
});

describe('buildVisitListQuery', () => {
  it('cada pestaña devuelve sus visitas, de la más reciente a la más antigua', async () => {
    expect(await list('all')).toEqual([
      'a-sincronizada',
      'a-revision',
      'a-completada',
      'a-progreso-2',
      'a-progreso-1',
      'a-asignada',
    ]);
    expect(await list('inProgress')).toEqual(['a-progreso-2', 'a-progreso-1']);
    expect(await list('assigned')).toEqual(['a-asignada']);
    expect(await list('completed')).toEqual(['a-sincronizada', 'a-revision', 'a-completada']);
  });

  it('busca en título, cliente y dirección sin distinguir mayúsculas', async () => {
    expect(await list('all', 'revisión')).toEqual(['a-revision', 'a-asignada']);
    expect(await list('all', 'industrias')).toEqual(['a-progreso-2']);
    expect(await list('all', 'SIEMPRE VIVA')).toEqual(['a-asignada']);
  });

  it('ignora mayúsculas también en letras acentuadas', async () => {
    expect(await list('all', 'ÉXITO')).toEqual(['a-asignada']);
    expect(await list('all', 'éxito')).toEqual(['a-asignada']);
    expect(await list('all', 'CAÑERÍAS')).toEqual(['a-completada']);
    expect(await list('all', 'ñandú')).toEqual(['a-completada']);
  });

  it('encuentra por el nombre visible del tipo de visita', async () => {
    // "Inspección de Energía" es el nombre visible del tipo `energia`.
    expect(await list('all', 'Energía')).toEqual(['a-progreso-2']);
    expect(await list('all', 'ups')).toEqual(['a-asignada']);
  });

  it('trata % y _ como texto literal, no como comodines', async () => {
    expect(await list('all', '100%')).toEqual(['a-progreso-1']);
    expect(await list('all', '%')).toEqual(['a-progreso-1']);
    expect(await list('all', 'Datos_SA')).toEqual(['a-progreso-1']);
    // Con "_" como comodín, "Datos_" coincidiría también con "Datos " u otros.
    expect(await list('all', '_')).toEqual(['a-progreso-1']);
    expect(await list('all', 'Datos\\SA')).toEqual([]);
  });

  it('combina pestaña y búsqueda', async () => {
    expect(await list('completed', 'revisión')).toEqual(['a-revision']);
    expect(await list('assigned', 'tablero')).toEqual([]);
  });

  it('pagina con el límite (se pide una fila de más para saber si hay más)', async () => {
    expect(await list('all', '', 2)).toEqual(['a-sincronizada', 'a-revision']);
    expect(await list('all', '', 3)).toHaveLength(3);
    expect(await list('all', '', 100)).toHaveLength(6);
  });

  it('nunca devuelve visitas de otro técnico', async () => {
    expect(await list('all', 'Éxito')).toEqual(['a-asignada']);
    expect(await list('inProgress', '', 50, TECH_B)).toEqual(['b-progreso']);
  });
});

describe('VISIT_BY_ID_SQL', () => {
  it('devuelve la visita del técnico', async () => {
    const row = await db.getOptional<Row>(VISIT_BY_ID_SQL, ['a-asignada', TECH_A]);
    expect(row && visitFromRow(row)).toMatchObject({
      id: 'a-asignada',
      clientName: 'Éxito Comercial',
      visitType: 'ups',
      status: 'assigned',
    });
  });

  it('NO devuelve la visita de otro técnico', async () => {
    expect(await db.getOptional(VISIT_BY_ID_SQL, ['b-progreso', TECH_A])).toBeNull();
  });
});

describe('visit.service contra SQLite real', () => {
  const user = { id: TECH_A, role: 'technician' as const };
  const input = {
    title: 'Nueva visita',
    visitType: 'datos' as const,
    address: 'Calle 9',
    description: null,
  };

  it('crea la visita asignada y pendiente de sincronizar', async () => {
    const result = await createVisit(db, user, input, NOW);

    expect(result.ok).toBe(true);
    const stored = await db.get<Row>(VISIT_BY_ID_SQL, ['visita-1', TECH_A]);
    expect(stored).toMatchObject({
      id: 'visita-1',
      technician_id: TECH_A,
      title: 'Nueva visita',
      visit_type: 'datos',
      address: 'Calle 9',
      description: null,
      status: 'assigned',
      sync_status: 'pendingSync',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      started_at: null,
    });
    // Aparece primera en el listado.
    expect((await list('all'))[0]).toBe('visita-1');
  });

  it('un rol sin permiso no crea nada', async () => {
    const result = await createVisit(db, { id: TECH_A, role: 'client' }, input, NOW);
    expect(result.ok).toBe(false);
    expect(db.rows('visits')).toHaveLength(VISITS.length);
  });

  it('inicia y finaliza la visita registrando las horas', async () => {
    const started = await startVisit(db, TECH_A, 'a-asignada', NOW);
    expect(started.ok && started.data.status).toBe('inProgress');
    expect(await db.get<Row>(VISIT_BY_ID_SQL, ['a-asignada', TECH_A])).toMatchObject({
      status: 'inProgress',
      started_at: NOW.toISOString(),
      sync_status: 'pendingSync',
    });

    const later = new Date('2026-06-10T15:00:00.000Z');
    const completed = await completeVisit(db, TECH_A, 'a-asignada', later);
    expect(completed.ok && completed.data.completedAt).toBe(later.toISOString());
    expect(await db.get<Row>(VISIT_BY_ID_SQL, ['a-asignada', TECH_A])).toMatchObject({
      status: 'completed',
      started_at: NOW.toISOString(),
      completed_at: later.toISOString(),
      updated_at: later.toISOString(),
    });
  });

  it('una transición inválida no cambia nada', async () => {
    const before = db.rows('visits');
    const result = await completeVisit(db, TECH_A, 'a-asignada', NOW);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('invalid_transition');
    expect(db.rows('visits')).toEqual(before);
  });

  it('no inicia la visita de otro técnico', async () => {
    const result = await startVisit(db, TECH_A, 'b-progreso', NOW);
    expect(!result.ok && result.error.message).toBe(VISIT_MESSAGES.notFound);
    expect(
      (await db.get<Row>('SELECT status FROM visits WHERE id = ?', ['b-progreso'])).status,
    ).toBe('inProgress');
  });

  it('si la escritura falla en SQLite, la transacción se deshace (ROLLBACK real)', async () => {
    db.raw.exec(`CREATE TRIGGER fallo BEFORE UPDATE ON visits
      BEGIN SELECT RAISE(ABORT, 'disco lleno simulado'); END`);
    const before = db.rows('visits');

    const result = await startVisit(db, TECH_A, 'a-asignada', NOW);

    expect(!result.ok && result.error.kind).toBe('database');
    expect(db.rows('visits')).toEqual(before);
    expect(db.raw.isTransaction).toBe(false);
  });
});
