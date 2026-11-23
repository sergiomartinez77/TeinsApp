import { appSchema } from '../powersync/schema';

const COMMON = ['created_at', 'updated_at'];

/** Columnas de cada tabla en PostgreSQL (migración 001, las 20261118* y 20261122*), sin `id`. */
const SERVER_COLUMNS: Record<string, string[]> = {
  profiles: ['email', 'full_name', 'role', 'phone', 'avatar_url', 'is_active', ...COMMON],
  visit_types: ['name', 'description', 'icon', 'is_active', ...COMMON],
  form_templates: ['name', 'visit_type', 'version', 'sections_json', 'is_active', ...COMMON],
  visits: [
    'technician_id',
    'client_id',
    'client_name',
    'title',
    'description',
    'visit_type',
    'address',
    'status',
    'sync_status',
    'form_template_id',
    'form_template_version',
    'observations',
    'started_at',
    'completed_at',
    'latitude',
    'longitude',
    ...COMMON,
  ],
  form_responses: [
    'visit_id',
    'template_id',
    'template_key',
    'template_version',
    'responses',
    'sync_status',
    'is_complete',
    'completed_at',
    ...COMMON,
  ],
  material_catalog: [
    'code',
    'name',
    'description',
    'unit',
    'category',
    'is_active',
    'min_stock',
    ...COMMON,
  ],
  visit_materials: [
    'visit_id',
    'material_id',
    'is_custom',
    'material_code',
    'material_name',
    'unit',
    'quantity',
    'observations',
    'sync_status',
    ...COMMON,
  ],
  photos: [
    'visit_id',
    'form_field_id',
    'local_path',
    'storage_path',
    'storage_url',
    'caption',
    'sync_status',
    'file_size_bytes',
    'width',
    'height',
    'captured_at',
    'uploaded_at',
    'latitude',
    'longitude',
    'location_accuracy',
    'taken_at',
  ],
  annotations: [
    'visit_id',
    'title',
    'elements',
    'base_image_path',
    'canvas_width',
    'canvas_height',
    'format_version',
    'sync_status',
    ...COMMON,
  ],
  annotation_figures: [
    'technician_id',
    'name',
    'elements',
    'width',
    'height',
    'sync_status',
    ...COMMON,
  ],
  // material_stock no tiene `id` en el servidor: la clave es material_id
  // (el stream lo entrega como `material_id AS id`) y no tiene created_at.
  material_stock: ['material_id', 'purchased', 'adjusted', 'used', 'on_hand', 'updated_at'],
  material_stock_movements: [
    'material_id',
    'kind',
    'quantity',
    'note',
    'created_by',
    'sync_status',
    ...COMMON,
  ],
};

describe('esquema local de PowerSync', () => {
  const tables = new Map(appSchema.tables.map((table) => [table.name, table]));
  const columnNames = (name: string) => tables.get(name)?.columns.map((col) => col.name) ?? [];

  it('es un esquema válido', () => {
    expect(() => appSchema.validate()).not.toThrow();
  });

  it('incluye las 12 tablas sincronizadas y la tabla local de incidencias', () => {
    expect([...tables.keys()].sort()).toEqual(
      [...Object.keys(SERVER_COLUMNS), 'sync_issues'].sort(),
    );
  });

  it.each(Object.keys(SERVER_COLUMNS))(
    '%s: cada columna local existe con el mismo nombre en el servidor',
    (name) => {
      const local = columnNames(name);
      expect(local.length).toBeGreaterThan(0);
      for (const columnName of local) {
        expect(SERVER_COLUMNS[name]).toContain(columnName);
      }
    },
  );

  it('las columnas JSON usan el nombre del servidor', () => {
    expect(columnNames('form_responses')).toContain('responses');
    expect(columnNames('form_responses')).not.toContain('responses_json');
    expect(columnNames('annotations')).toContain('elements');
    expect(columnNames('annotations')).not.toContain('elements_json');
    expect(columnNames('annotation_figures')).toContain('elements');
  });

  it('solo sync_issues es local; el resto se sincroniza', () => {
    for (const [name, table] of tables) {
      expect(table.localOnly).toBe(name === 'sync_issues');
    }
  });
});

describe('columnas nuevas (migraciones 20261118*)', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs: typeof import('node:fs') = require('node:fs');
  const path: typeof import('node:path') = require('node:path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = path.resolve(__dirname, '..', '..', '..');
  const migrations = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((name) => name.startsWith('20261118'))
    .map((name) => fs.readFileSync(path.join(root, 'supabase', 'migrations', name), 'utf8'))
    .join('\n');
  const syncConfig = fs.readFileSync(path.join(root, 'powersync', 'sync-config.yaml'), 'utf8');

  it.each([
    ['photos', 'latitude'],
    ['photos', 'longitude'],
    ['photos', 'location_accuracy'],
    ['photos', 'taken_at'],
    ['visit_materials', 'is_custom'],
    ['form_responses', 'template_key'],
  ])('%s.%s existe en el servidor (migración) y en el esquema local', (table, column) => {
    const statement = `ALTER TABLE public.${table}`;
    const column_ = `ADD COLUMN IF NOT EXISTS ${column} `;
    const at = migrations.indexOf(statement);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(migrations.indexOf(column_, at)).toBeGreaterThan(at);
    expect(appSchema.tables.find((t) => t.name === table)?.columns.map((c) => c.name)).toContain(
      column,
    );
  });

  it('la consulta de visit_materials de PowerSync incluye is_custom', () => {
    expect(syncConfig).toMatch(/SELECT id, visit_id, material_id, is_custom,/);
  });
});

describe('inventario (migración 20261122000200)', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs: typeof import('node:fs') = require('node:fs');
  const path: typeof import('node:path') = require('node:path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = path.resolve(__dirname, '..', '..', '..');
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261122000200_inventario.sql'),
    'utf8',
  );
  const syncConfig = fs.readFileSync(path.join(root, 'powersync', 'sync-config.yaml'), 'utf8');
  const localColumns = (table: string) =>
    appSchema.tables.find((t) => t.name === table)?.columns.map((c) => c.name) ?? [];

  it('min_stock existe en el servidor y en el esquema local, y llega como real', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS min_stock NUMERIC(12, 3)');
    expect(localColumns('material_catalog')).toContain('min_stock');
    expect(syncConfig).toContain('CAST(min_stock AS real) AS min_stock');
  });

  it('material_stock llega con id = material_id y las cantidades como real', () => {
    expect(syncConfig).toMatch(/SELECT material_id AS id, material_id,/);
    for (const column of ['purchased', 'adjusted', 'used', 'on_hand']) {
      expect(syncConfig).toContain(`CAST(${column} AS real) AS ${column}`);
    }
  });

  it('la consulta de cada tabla nueva enumera todas las columnas locales', () => {
    const query = (table: string) => {
      const at = syncConfig.indexOf(`FROM ${table}`);
      return syncConfig.slice(syncConfig.lastIndexOf('SELECT', at), at);
    };
    for (const table of ['material_catalog', 'material_stock', 'material_stock_movements']) {
      const select = query(table);
      for (const column of localColumns(table)) {
        expect(select).toMatch(new RegExp(`\\b${column}\\b`));
      }
    }
  });
});

describe('sync-config: administración y oficina reciben todas las visitas', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs: typeof import('node:fs') = require('node:fs');
  const path: typeof import('node:path') = require('node:path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = path.resolve(__dirname, '..', '..', '..');
  const syncConfig = fs.readFileSync(path.join(root, 'powersync', 'sync-config.yaml'), 'utf8');
  const stream = (name: string) => {
    const start = syncConfig.indexOf(`\n  ${name}:\n`);
    expect(start).toBeGreaterThan(0);
    const next = syncConfig.slice(start + 1).search(/\n {2}[a-z_]+:\n/);
    return next < 0 ? syncConfig.slice(start) : syncConfig.slice(start, start + 1 + next);
  };
  const visitMaterialsColumns = (text: string) =>
    /SELECT (id, visit_id, material_id[\s\S]*?)\s+FROM visit_materials/
      .exec(text)?.[1]
      ?.replace(/\s+/g, ' ');

  it('el stream visitas_de_oficina solo se entrega a perfiles activos admin u oficina', () => {
    const office = stream('visitas_de_oficina');
    expect(office).toContain('auto_subscribe: true');
    expect(office).toMatch(
      /SELECT id FROM profiles\s+WHERE id = auth\.user_id\(\) AND is_active = true\s+AND \(role = 'admin' OR role = 'office'\)/,
    );
    for (const table of ['visits', 'form_responses', 'photos', 'annotations', 'profiles']) {
      expect(office).toContain(`SELECT * FROM ${table} WHERE auth.user_id() IN usuario_de_oficina`);
    }
    expect(office).toContain('FROM visit_materials WHERE auth.user_id() IN usuario_de_oficina');
  });

  it('visit_materials llega con las mismas columnas (y el CAST) en los dos streams', () => {
    const own = visitMaterialsColumns(stream('detalle_de_mis_visitas'));
    expect(own).toContain('CAST(quantity AS real) AS quantity');
    expect(visitMaterialsColumns(stream('visitas_de_oficina'))).toBe(own);
  });

  it('los técnicos siguen recibiendo solo sus visitas', () => {
    expect(stream('mis_visitas')).toContain(
      'SELECT * FROM visits WHERE technician_id = auth.user_id()',
    );
  });
});
