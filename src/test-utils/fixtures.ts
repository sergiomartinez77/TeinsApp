import type { Row, TestDatabase } from './test-database';

/**
 * Filas de ejemplo para sembrar la base SQLite de test. Cada función devuelve
 * una fila completa con valores razonables; `overrides` cambia lo necesario.
 */

export const TECH_A = 'tecnico-a';
export const TECH_B = 'tecnico-b';

export const visitRow = (overrides: Row = {}): Row => ({
  id: 'v1',
  technician_id: TECH_A,
  client_id: null,
  client_name: 'Cliente Uno',
  title: 'Visita uno',
  description: null,
  visit_type: 'general',
  address: 'Calle 1',
  status: 'assigned',
  sync_status: 'synced',
  form_template_id: null,
  form_template_version: null,
  observations: null,
  created_at: '2026-06-01T08:00:00.000Z',
  updated_at: '2026-06-01T08:00:00.000Z',
  started_at: null,
  completed_at: null,
  latitude: null,
  longitude: null,
  ...overrides,
});

export const catalogRow = (overrides: Row = {}): Row => ({
  id: 'm1',
  code: 'MAT-001',
  name: 'Material uno',
  description: null,
  unit: 'unidad',
  category: 'General',
  is_active: 1,
  ...overrides,
});

export const visitMaterialRow = (overrides: Row = {}): Row => ({
  id: 'vm1',
  visit_id: 'v1',
  material_id: 'm1',
  material_code: 'MAT-001',
  material_name: 'Material uno',
  unit: 'unidad',
  quantity: 1,
  observations: null,
  sync_status: 'pendingSync',
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-01T09:00:00.000Z',
  ...overrides,
});

export const photoRow = (overrides: Row = {}): Row => ({
  id: 'p1',
  visit_id: 'v1',
  form_field_id: null,
  local_path: 'teins_photos/p1.jpg',
  storage_path: null,
  storage_url: null,
  caption: null,
  sync_status: 'local',
  captured_at: '2026-06-01T09:00:00.000Z',
  uploaded_at: null,
  file_size_bytes: 1000,
  width: 1920,
  height: 1080,
  ...overrides,
});

/** Plano en el formato 2 (centímetros, sin lienzo de referencia), como los crea la app. */
export const annotationRow = (overrides: Row = {}): Row => ({
  id: 'a1',
  visit_id: 'v1',
  title: null,
  elements: '[]',
  base_image_path: null,
  canvas_width: null,
  canvas_height: null,
  format_version: 2,
  sync_status: 'pendingSync',
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-01T09:00:00.000Z',
  ...overrides,
});

/** Figura de la biblioteca de un técnico (una línea de 100 cm). */
export const figureRow = (overrides: Row = {}): Row => ({
  id: 'f1',
  technician_id: TECH_A,
  name: 'Figura uno',
  elements: JSON.stringify([
    {
      id: 'fe1',
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      color: 0xff000000,
      strokeWidth: 3,
      text: null,
      fontSize: null,
      opacity: 1,
    },
  ]),
  width: 100,
  height: 0,
  sync_status: 'pendingSync',
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-01T09:00:00.000Z',
  ...overrides,
});

export const responseRow = (overrides: Row = {}): Row => ({
  id: 'r1',
  visit_id: 'v1',
  template_id: null,
  template_version: 1,
  responses: '{}',
  sync_status: 'pendingSync',
  is_complete: 0,
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-01T09:00:00.000Z',
  completed_at: null,
  ...overrides,
});

/** Plantilla mínima válida (una sección con un campo de texto obligatorio). */
export const templateRow = (overrides: Row = {}): Row => ({
  id: 'tpl-db-1',
  name: 'Plantilla de la base',
  visit_type: 'general',
  version: 3,
  sections_json: JSON.stringify([
    {
      id: 's1',
      title: 'Datos',
      fields: [{ id: 'f1', type: 'text', label: 'Observación', required: true }],
    },
  ]),
  is_active: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** Existencias calculadas por el servidor (`id` = `material_id`). */
export const materialStockRow = (overrides: Row = {}): Row => {
  const materialId = (overrides.material_id ?? overrides.id ?? 'm1') as string;
  return {
    id: materialId,
    material_id: materialId,
    purchased: 0,
    adjusted: 0,
    used: 0,
    on_hand: 0,
    updated_at: '2026-06-01T09:00:00.000Z',
    ...overrides,
  };
};

/** Compra ya sincronizada (llegó del servidor). */
export const stockMovementRow = (overrides: Row = {}): Row => ({
  id: 'mv1',
  material_id: 'm1',
  kind: 'purchase',
  quantity: 10,
  note: null,
  created_by: 'oficina',
  sync_status: 'synced',
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-01T09:00:00.000Z',
  ...overrides,
});

export const syncIssueRow = (overrides: Row = {}): Row => ({
  id: 'si1',
  table_name: 'visits',
  row_id: 'v1',
  operation: 'PUT',
  code: '23505',
  message: 'duplicado',
  payload: null,
  created_at: '2026-06-01T09:00:00.000Z',
  ...overrides,
});

/** Ids de las filas, en el orden en que llegan. */
export const ids = (rows: readonly Row[]): unknown[] => rows.map((row) => row.id);

/** Número de filas de una tabla. */
export const countRows = (db: TestDatabase, table: string): number => db.rows(table).length;
