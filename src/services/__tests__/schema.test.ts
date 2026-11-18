import { appSchema } from '../powersync/schema';

const COMMON = ['created_at', 'updated_at'];

/** Columnas de cada tabla en PostgreSQL (migración 001 y las 20261118*), sin `id`. */
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
  material_catalog: ['code', 'name', 'description', 'unit', 'category', 'is_active', ...COMMON],
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

  it('incluye las 9 tablas sincronizadas y la tabla local de incidencias', () => {
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
