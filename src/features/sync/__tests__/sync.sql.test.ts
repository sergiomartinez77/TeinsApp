import { CrudEntry, UpdateType, type AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { IN_PROGRESS_VISITS_SQL, VISIT_STATS_SQL } from '@/features/visits/services/visit.queries';
import { buildCatalogQuery } from '@/features/materials/services/material.queries';
import { SupabaseConnector } from '@/services/powersync/connector';
import { syncIssueRow, TECH_A } from '@/test-utils/fixtures';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import { DEMO_MATERIALS, DEMO_VISITS, seedDemoData } from '../demo-seed';
import { SYNC_ISSUE_COUNT_SQL } from '../hooks/useSyncIssueCount';

/**
 * Datos demo, incidencias de sincronización y su registro desde el conector,
 * ejecutados contra SQLite real.
 */

// El paquete real es ESM y no se carga en Jest: se usa el sustituto sobre SQLite real.
jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-10T12:00:00.000Z');

let db: TestDatabase;

beforeEach(() => {
  let next = 0;
  db = createTestDatabase({ uuid: () => `uuid-${(next += 1)}` });
});

describe('seedDemoData', () => {
  it('carga el catálogo y las visitas demo con uuid() y fechas relativas', async () => {
    await seedDemoData(db, TECH_A, NOW);

    const catalog = await db.getAll<Row>(
      buildCatalogQuery({ search: '', limit: 100 }).sql,
      buildCatalogQuery({ search: '', limit: 100 }).parameters,
    );
    expect(catalog).toHaveLength(DEMO_MATERIALS.length);
    expect(new Set(catalog.map((row) => row.id)).size).toBe(DEMO_MATERIALS.length);
    expect(catalog.every((row) => row.is_active === 1)).toBe(true);

    const visits = db.rows('visits');
    expect(visits).toHaveLength(DEMO_VISITS.length);
    expect(visits.every((row) => row.technician_id === TECH_A && row.sync_status === 'local')).toBe(
      true,
    );

    expect(await db.get(VISIT_STATS_SQL, [TECH_A])).toEqual({
      assigned: 2,
      in_progress: 1,
      completed: 0,
      pending_sync: 3,
    });
    const [inProgress] = await db.getAll<Row>(IN_PROGRESS_VISITS_SQL, [TECH_A, 3]);
    expect(inProgress).toMatchObject({
      title: 'VT-00002 — Inspección Energía Planta Norte',
      // Creada hace 24 h e iniciada una hora después.
      created_at: '2026-06-09T12:00:00.000Z',
      started_at: '2026-06-09T13:00:00.000Z',
      updated_at: '2026-06-09T13:00:00.000Z',
    });
  });

  it('es todo o nada: si una inserción falla no queda ningún dato demo', async () => {
    db.raw.exec(`CREATE TRIGGER fallo BEFORE INSERT ON visits
      WHEN NEW.title LIKE 'VT-00003%'
      BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);

    await expect(seedDemoData(db, TECH_A, NOW)).rejects.toThrow('fallo simulado');

    expect(db.rows('material_catalog')).toEqual([]);
    expect(db.rows('visits')).toEqual([]);
  });
});

describe('SYNC_ISSUE_COUNT_SQL', () => {
  it('cuenta las incidencias registradas', async () => {
    expect(await db.get(SYNC_ISSUE_COUNT_SQL)).toEqual({ count: 0 });
    db.insert('sync_issues', [syncIssueRow({ id: 'a' }), syncIssueRow({ id: 'b' })]);
    expect(await db.get(SYNC_ISSUE_COUNT_SQL)).toEqual({ count: 2 });
  });
});

describe('SupabaseConnector.uploadData: registro de incidencias (INSERT con uuid())', () => {
  function supabaseRejecting(error: { code: string; message: string } | null) {
    const upsert = jest.fn(async () => ({ error }));
    return {
      upsert,
      client: { from: () => ({ upsert }) } as unknown as SupabaseClient,
    };
  }

  function withQueue(entries: CrudEntry[]) {
    const complete = jest.fn(async () => undefined);
    const source = {
      ...db,
      getNextCrudTransaction: async () => ({ crud: entries, complete }),
    };
    return { source: source as unknown as AbstractPowerSyncDatabase, complete };
  }

  it('guarda en sync_issues el cambio rechazado, con sus datos, antes de confirmar', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
    const { client } = supabaseRejecting({ code: '23505', message: 'clave duplicada' });
    const entry = new CrudEntry(1, UpdateType.PUT, 'visits', 'v-1', 1, { title: 'Duplicada' });
    const { source, complete } = withQueue([entry]);

    await new SupabaseConnector(client, 'https://ps.example').uploadData(source);

    expect(db.rows('sync_issues')).toEqual([
      {
        id: 'uuid-1',
        table_name: 'visits',
        row_id: 'v-1',
        operation: 'PUT',
        code: '23505',
        message: 'clave duplicada',
        payload: JSON.stringify({ title: 'Duplicada' }),
        created_at: expect.any(String),
      },
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await db.get(SYNC_ISSUE_COUNT_SQL)).toEqual({ count: 1 });
    jest.restoreAllMocks();
  });

  it('una tabla de solo lectura queda registrada sin datos si no los hay', async () => {
    const { client, upsert } = supabaseRejecting(null);
    const entry = new CrudEntry(1, UpdateType.DELETE, 'material_catalog', 'm-1', 1);
    const { source } = withQueue([entry]);

    await new SupabaseConnector(client, 'https://ps.example').uploadData(source);

    expect(upsert).not.toHaveBeenCalled();
    expect(db.rows('sync_issues')).toMatchObject([
      {
        table_name: 'material_catalog',
        operation: 'DELETE',
        code: 'READ_ONLY_TABLE',
        payload: null,
      },
    ]);
  });
});
