import { loadVisitReportData } from '@/features/reports/services/visit-report.data';
import {
  canEditVisit,
  isOwnVisit,
  readOnlyVisitMessage,
  visitFromRow,
  visitOwnerLabel,
  visitScopeFor,
} from '@/models/visit.model';
import { TECH_A, TECH_B, visitRow } from '@/test-utils/fixtures';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import {
  buildInProgressQuery,
  buildVisitByIdQuery,
  buildVisitListQuery,
  buildVisitStatsQuery,
} from '../services/visit.queries';

/**
 * Quién ve y quién edita cada visita: el técnico, solo las suyas; admin y
 * oficina, todas las del teléfono (solo lectura las de otros técnicos).
 */

jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

describe('reglas del modelo', () => {
  const own = visitFromRow(visitRow({ technician_id: TECH_A, status: 'inProgress' }));
  const closed = visitFromRow(visitRow({ technician_id: TECH_A, status: 'completed' }));
  const foreign = visitFromRow(
    visitRow({ technician_id: TECH_B, status: 'assigned', technician_name: '  Luis Gómez ' }),
  );
  const unknownOwner = visitFromRow(visitRow({ technician_id: TECH_B }));

  it('alcance por rol', () => {
    expect(visitScopeFor({ id: TECH_A, role: 'technician' })).toBe(TECH_A);
    expect(visitScopeFor({ id: 'x', role: 'admin' })).toBeNull();
    expect(visitScopeFor({ id: 'x', role: 'office' })).toBeNull();
    expect(visitScopeFor({ id: 'x', role: 'client' })).toBe('x');
  });

  it('solo su técnico edita, y solo abierta', () => {
    expect(isOwnVisit(own, TECH_A)).toBe(true);
    expect(canEditVisit(own, { id: TECH_A })).toBe(true);
    expect(canEditVisit(closed, { id: TECH_A })).toBe(false);
    expect(canEditVisit(foreign, { id: 'admin' })).toBe(false);
    expect(foreign.technicianName).toBe('Luis Gómez');
    expect(visitOwnerLabel(foreign)).toBe('Visita de Luis Gómez');
    expect(visitOwnerLabel(unknownOwner)).toBe('Visita de otro técnico');
  });

  it('aviso de solo lectura', () => {
    expect(readOnlyVisitMessage(own, { id: TECH_A }, 'cerrada')).toBeNull();
    expect(readOnlyVisitMessage(closed, { id: TECH_A }, 'cerrada')).toBe('cerrada');
    expect(readOnlyVisitMessage(foreign, { id: 'admin' }, 'cerrada')).toBe(
      'Visita de Luis Gómez: puedes consultarla, pero solo su técnico puede editarla.',
    );
  });
});

describe('consultas con alcance', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
    db.insert('profiles', [
      { id: TECH_A, full_name: 'Ana Pérez', email: 'ana@teins.com' },
      { id: TECH_B, full_name: '  ', email: 'luis@teins.com' },
    ]);
    db.insert('visits', [
      visitRow({
        id: 'a1',
        technician_id: TECH_A,
        status: 'inProgress',
        created_at: '2026-06-02T08:00:00.000Z',
      }),
      visitRow({
        id: 'a2',
        technician_id: TECH_A,
        status: 'completed',
        created_at: '2026-06-01T08:00:00.000Z',
      }),
      visitRow({
        id: 'b1',
        technician_id: TECH_B,
        status: 'inProgress',
        created_at: '2026-06-03T08:00:00.000Z',
      }),
    ]);
  });

  const all = async (query: { sql: string; parameters: unknown[] }) =>
    db.getAll<Row>(query.sql, query.parameters);

  it('listado: técnico (las suyas) o todas, con el nombre del técnico', async () => {
    const mine = await all(buildVisitListQuery(TECH_A, { filter: 'all', search: '', limit: 10 }));
    expect(mine.map((row) => row.id)).toEqual(['a1', 'a2']);
    expect(mine[0]?.technician_name).toBe('Ana Pérez');
    const everything = await all(
      buildVisitListQuery(null, { filter: 'all', search: '', limit: 10 }),
    );
    expect(everything.map((row) => row.id)).toEqual(['b1', 'a1', 'a2']);
    // Sin nombre, el correo.
    expect(everything[0]?.technician_name).toBe('luis@teins.com');
    const progress = await all(
      buildVisitListQuery(null, { filter: 'inProgress', search: '', limit: 10 }),
    );
    expect(progress.map((row) => row.id)).toEqual(['b1', 'a1']);
  });

  it('una visita por id, dashboard y en progreso', async () => {
    expect(await all(buildVisitByIdQuery('b1', TECH_A))).toEqual([]);
    expect((await all(buildVisitByIdQuery('b1', null)))[0]).toMatchObject({ id: 'b1' });
    expect((await all(buildVisitStatsQuery(TECH_A)))[0]).toMatchObject({
      in_progress: 1,
      completed: 1,
    });
    expect((await all(buildVisitStatsQuery(null)))[0]).toMatchObject({
      in_progress: 2,
      completed: 1,
    });
    expect((await all(buildInProgressQuery(null, 5))).map((row) => row.id).sort()).toEqual([
      'a1',
      'b1',
    ]);
    expect((await all(buildInProgressQuery(TECH_A, 5))).map((row) => row.id)).toEqual(['a1']);
  });

  it('informe: admin/oficina cargan cualquier visita con su técnico; el técnico solo las suyas', async () => {
    const reader = { read: jest.fn(async () => null) };
    const foreign = await loadVisitReportData(db, {
      technicianId: null,
      currentUserId: 'admin',
      visitId: 'b1',
      photoReader: reader,
      fallbackTechnicianName: 'Admin',
    });
    expect(foreign.ok && foreign.data.technicianName).toBe('luis@teins.com');
    const denied = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'b1',
      photoReader: reader,
    });
    expect(denied.ok).toBe(false);
    const own = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'a1',
      photoReader: reader,
      fallbackTechnicianName: 'Respaldo',
    });
    expect(own.ok && own.data.technicianName).toBe('Ana Pérez');
  });
});
