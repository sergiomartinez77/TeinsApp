import { appSchema } from '@/services/powersync/schema';

import { catalogRow, visitRow } from '../fixtures';
import { createTestDatabase, schemaStatements, writtenTable, type Row } from '../test-database';

/**
 * Pruebas de la propia base SQLite de test: si esto falla, los demás tests
 * de SQL real no son fiables.
 */

describe('createTestDatabase: esquema', () => {
  it('crea exactamente las tablas y columnas de appSchema (incluida sync_issues)', () => {
    const db = createTestDatabase();
    const tables = db
      .querySync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .map((row) => row.name);
    expect(tables).toEqual(appSchema.tables.map((table) => table.name).sort());
    expect(tables).toContain('sync_issues');

    for (const table of appSchema.tables) {
      const info = db.querySync<{ name: string; type: string; pk: number }>(
        `PRAGMA table_info("${table.name}")`,
      );
      expect(info.map((column) => [column.name, column.type])).toEqual([
        ['id', 'TEXT'],
        ...table.columns.map((column) => [column.name, column.type]),
      ]);
      expect(info.find((column) => column.name === 'id')?.pk).toBe(1);
    }
  });

  it('crea los índices declarados, con su orden', () => {
    const statements = schemaStatements();
    expect(statements).toContain(
      'CREATE INDEX "visits__v_created" ON "visits" ("created_at" DESC)',
    );
    const db = createTestDatabase();
    const indexes = db.querySync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%\\_\\_%' ESCAPE '\\'",
    );
    const declared = appSchema.tables.reduce((total, table) => total + table.indexes.length, 0);
    expect(indexes).toHaveLength(declared);
  });

  it('registra la función uuid() con el generador indicado', () => {
    let next = 0;
    const db = createTestDatabase({ uuid: () => `u-${(next += 1)}` });
    db.raw.exec("INSERT INTO visit_types (id, name) VALUES (uuid(), 'a'), (uuid(), 'b')");
    expect(db.rows('visit_types').map((row) => row.id)).toEqual(['u-1', 'u-2']);
  });

  it('por defecto uuid() genera UUID v4 distintos', () => {
    const db = createTestDatabase();
    const [first, second] = db.querySync<{ id: string }>(
      'SELECT uuid() AS id UNION ALL SELECT uuid()',
    );
    expect(first?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first?.id).not.toBe(second?.id);
  });
});

describe('createTestDatabase: lecturas y escrituras', () => {
  it('execute, getAll, getOptional y get funcionan como en PowerSync', async () => {
    const db = createTestDatabase();
    const inserted = await db.execute(
      'INSERT INTO material_catalog (id, code, name, is_active) VALUES (?, ?, ?, ?)',
      ['m1', 'A', 'Cable', true],
    );
    expect(inserted.rowsAffected).toBe(1);

    expect(await db.getAll('SELECT id, is_active FROM material_catalog')).toEqual([
      { id: 'm1', is_active: 1 },
    ]);
    expect(await db.getOptional('SELECT id FROM material_catalog WHERE id = ?', ['x'])).toBeNull();
    await expect(db.get('SELECT id FROM material_catalog WHERE id = ?', ['x'])).rejects.toThrow(
      'Result set is empty',
    );
    const selected = await db.execute('SELECT code FROM material_catalog');
    expect(selected.rows._array).toEqual([{ code: 'A' }]);
    expect(selected.rows.item(0)).toEqual({ code: 'A' });
  });

  it('aplica la afinidad de tipo de cada columna', () => {
    const db = createTestDatabase();
    db.insert('visit_materials', [{ id: 'vm', quantity: '2.5', visit_id: 7 }]);
    expect(db.rows('visit_materials')[0]).toMatchObject({ quantity: 2.5, visit_id: '7' });
  });

  it('convierte undefined en NULL y rechaza objetos', async () => {
    const db = createTestDatabase();
    await db.execute('INSERT INTO visit_types (id, name) VALUES (?, ?)', ['t', undefined]);
    expect(db.rows('visit_types')[0]?.name).toBeNull();
    await expect(
      db.execute('INSERT INTO visit_types (id, name) VALUES (?, ?)', ['u', { a: 1 }]),
    ).rejects.toThrow('Parámetro SQL no admitido');
  });

  it('detecta la tabla de cada escritura', () => {
    expect(writtenTable('INSERT INTO visits (id) VALUES (?)')).toBe('visits');
    expect(writtenTable('  UPDATE photos SET x = 1')).toBe('photos');
    expect(writtenTable('DELETE FROM visit_materials WHERE id = ?')).toBe('visit_materials');
    expect(writtenTable('INSERT OR REPLACE INTO annotations (id) VALUES (1)')).toBe('annotations');
    expect(writtenTable('SELECT * FROM visits')).toBeNull();
  });
});

describe('createTestDatabase: transacciones', () => {
  it('confirma con COMMIT y avisa una sola vez con las tablas cambiadas', async () => {
    const db = createTestDatabase();
    const changes: string[][] = [];
    db.onChange({ onChange: ({ changedTables }) => void changes.push(changedTables) });

    await db.writeTransaction(async (tx) => {
      await tx.execute('INSERT INTO visits (id, technician_id) VALUES (?, ?)', ['v1', 't']);
      await tx.execute('INSERT INTO photos (id, visit_id) VALUES (?, ?)', ['p1', 'v1']);
    });

    expect(db.rows('visits')).toHaveLength(1);
    expect(changes).toEqual([['visits', 'photos']]);
    expect(db.getVersion()).toBe(1);
  });

  it('un fallo a mitad de la transacción hace ROLLBACK de todo', async () => {
    const db = createTestDatabase();
    const listener = jest.fn();
    db.subscribe(listener);

    await expect(
      db.writeTransaction(async (tx) => {
        await tx.execute('INSERT INTO visits (id, technician_id) VALUES (?, ?)', ['v1', 't']);
        // Clave primaria duplicada: error real de SQLite.
        await tx.execute('INSERT INTO visits (id, technician_id) VALUES (?, ?)', ['v1', 't']);
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/);

    expect(db.rows('visits')).toEqual([]);
    expect(db.raw.isTransaction).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('serializa las transacciones concurrentes (cerrojo de escritura)', async () => {
    const db = createTestDatabase();
    const order: string[] = [];
    const slow = db.writeTransaction(async (tx) => {
      order.push('a:inicio');
      await new Promise((resolve) => setTimeout(resolve, 5));
      await tx.execute("INSERT INTO visit_types (id) VALUES ('a')");
      order.push('a:fin');
    });
    const fast = db.writeTransaction(async (tx) => {
      order.push('b:inicio');
      await tx.execute("INSERT INTO visit_types (id) VALUES ('b')");
      order.push('b:fin');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:inicio', 'a:fin', 'b:inicio', 'b:fin']);
  });

  it('las lecturas de nivel superior no ven datos sin confirmar', async () => {
    const db = createTestDatabase();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = db.writeTransaction(async (tx) => {
      await tx.execute("INSERT INTO visit_types (id) VALUES ('a')");
      await gate;
    });
    const reading = db.getAll<Row>('SELECT id FROM visit_types');
    release();
    await writing;
    // La lectura esperó a la confirmación: ve la fila ya confirmada.
    expect(await reading).toEqual([{ id: 'a' }]);
  });

  it('rechaza una escritura de nivel superior dentro de una transacción', async () => {
    const db = createTestDatabase();
    await expect(
      db.writeTransaction(async () => {
        await db.execute("INSERT INTO visit_types (id) VALUES ('a')");
      }),
    ).rejects.toThrow('dentro de una transacción');
    expect(db.rows('visit_types')).toEqual([]);
  });

  it('permite leer con la base dentro de una transacción', async () => {
    const db = createTestDatabase();
    const seen = await db.writeTransaction(async (tx) => {
      await tx.execute("INSERT INTO visit_types (id) VALUES ('a')");
      return db.getAll('SELECT id FROM visit_types');
    });
    expect(seen).toEqual([{ id: 'a' }]);
  });
});

describe('createTestDatabase: ciclo de vida', () => {
  it('disconnectAndClear borra todos los datos y close cierra la base', async () => {
    const db = createTestDatabase();
    db.insert('visits', [visitRow()]);
    db.insert('material_catalog', [catalogRow()]);

    await db.disconnectAndClear();
    expect(db.rows('visits')).toEqual([]);
    expect(db.rows('material_catalog')).toEqual([]);

    await db.close();
    expect(db.closed).toBe(true);
    expect(db.events).toEqual(['clear', 'close']);
    await expect(db.getAll('SELECT 1')).rejects.toThrow('cerrada');
  });

  it('publica el estado de sincronización a los oyentes', async () => {
    const db = createTestDatabase();
    const statusChanged = jest.fn();
    const stop = db.registerListener({ statusChanged });
    db.setStatus({ connected: true });
    stop();
    db.setStatus({ connected: false });
    expect(statusChanged).toHaveBeenCalledTimes(1);
    expect(db.currentStatus.connected).toBe(false);

    db.setUploadQueueCount(4);
    expect(await db.getUploadQueueStats()).toEqual({ count: 4 });
  });

  it('onChange filtra por tablas y se cancela con la señal', () => {
    const db = createTestDatabase();
    const controller = new AbortController();
    const onChange = jest.fn();
    db.onChange({ onChange }, { tables: ['photos'], signal: controller.signal });

    db.insert('visits', [visitRow()]);
    expect(onChange).not.toHaveBeenCalled();
    db.insert('photos', [{ id: 'p1', visit_id: 'v1' }]);
    expect(onChange).toHaveBeenCalledWith({ changedTables: ['photos'] });

    controller.abort();
    db.insert('photos', [{ id: 'p2', visit_id: 'v1' }]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
