import { column, Schema, Table } from '@powersync/react-native';

/**
 * Esquema SQLite local gestionado por PowerSync (9 tablas sincronizadas).
 *
 * PowerSync aplica este esquema como vistas sobre sus tablas internas:
 * no hacen falta migraciones manuales en el cliente. La columna `id`
 * (UUID en texto) es implícita en todas las tablas.
 *
 * Tipos: UUID y fechas → TEXT (ISO 8601 UTC); BOOLEAN → INTEGER (1/0);
 * JSONB → TEXT con el JSON serializado.
 *
 * IMPORTANTE — nombres de columna: PowerSync empareja las columnas por nombre
 * con las de PostgreSQL. Por eso las columnas JSON se llaman igual que en el
 * servidor (`responses`, `elements`, `sections_json`); con otro nombre local
 * los datos descargados llegarían vacíos.
 */

const profiles = new Table({
  email: column.text,
  full_name: column.text,
  role: column.text,
  phone: column.text,
  avatar_url: column.text,
});

const visit_types = new Table({
  name: column.text,
  description: column.text,
  icon: column.text,
  is_active: column.integer,
});

const form_templates = new Table(
  {
    name: column.text,
    visit_type: column.text,
    version: column.integer,
    sections_json: column.text,
    is_active: column.integer,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { ft_visit_type: ['visit_type'] } },
);

const visits = new Table(
  {
    technician_id: column.text,
    client_id: column.text,
    client_name: column.text,
    title: column.text,
    description: column.text,
    visit_type: column.text,
    address: column.text,
    status: column.text,
    sync_status: column.text,
    form_template_id: column.text,
    form_template_version: column.integer,
    observations: column.text,
    created_at: column.text,
    updated_at: column.text,
    started_at: column.text,
    completed_at: column.text,
    latitude: column.real,
    longitude: column.real,
  },
  {
    indexes: {
      v_technician: ['technician_id'],
      v_status: ['status'],
      v_created: ['-created_at'],
    },
  },
);

const form_responses = new Table(
  {
    visit_id: column.text,
    template_id: column.text,
    template_version: column.integer,
    /** JSON: { "id_del_campo": valor } */
    responses: column.text,
    sync_status: column.text,
    is_complete: column.integer,
    created_at: column.text,
    updated_at: column.text,
    completed_at: column.text,
  },
  { indexes: { fr_visit: ['visit_id'] } },
);

const material_catalog = new Table(
  {
    code: column.text,
    name: column.text,
    description: column.text,
    unit: column.text,
    category: column.text,
    is_active: column.integer,
  },
  { indexes: { mc_code: ['code'], mc_name: ['name'], mc_category: ['category'] } },
);

const visit_materials = new Table(
  {
    visit_id: column.text,
    material_id: column.text,
    material_code: column.text,
    material_name: column.text,
    unit: column.text,
    quantity: column.real,
    observations: column.text,
    sync_status: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { vm_visit: ['visit_id'] } },
);

const photos = new Table(
  {
    visit_id: column.text,
    form_field_id: column.text,
    local_path: column.text,
    storage_path: column.text,
    storage_url: column.text,
    caption: column.text,
    sync_status: column.text,
    captured_at: column.text,
    uploaded_at: column.text,
    file_size_bytes: column.integer,
    width: column.integer,
    height: column.integer,
  },
  { indexes: { ph_visit: ['visit_id'], ph_sync: ['sync_status'] } },
);

const annotations = new Table(
  {
    visit_id: column.text,
    title: column.text,
    /** JSON: lista de elementos del canvas. */
    elements: column.text,
    base_image_path: column.text,
    canvas_width: column.real,
    canvas_height: column.real,
    sync_status: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { an_visit: ['visit_id'] } },
);

/**
 * Tabla solo local (no se sincroniza): cambios que el servidor rechazó de
 * forma definitiva. Los conflictos quedan registrados, nunca se descartan
 * en silencio.
 */
const sync_issues = new Table(
  {
    table_name: column.text,
    row_id: column.text,
    operation: column.text,
    code: column.text,
    message: column.text,
    /** JSON con los datos que no se pudieron subir. */
    payload: column.text,
    created_at: column.text,
  },
  { localOnly: true, indexes: { si_created: ['-created_at'] } },
);

export const appSchema = new Schema({
  profiles,
  visit_types,
  form_templates,
  visits,
  form_responses,
  material_catalog,
  visit_materials,
  photos,
  annotations,
  sync_issues,
});

export type Database = (typeof appSchema)['types'];
export type ProfileRow = Database['profiles'];
export type VisitTypeRow = Database['visit_types'];
export type FormTemplateRow = Database['form_templates'];
export type VisitRow = Database['visits'];
export type FormResponseRow = Database['form_responses'];
export type MaterialCatalogRow = Database['material_catalog'];
export type VisitMaterialRow = Database['visit_materials'];
export type PhotoRow = Database['photos'];
export type AnnotationRow = Database['annotations'];
export type SyncIssueRow = Database['sync_issues'];
