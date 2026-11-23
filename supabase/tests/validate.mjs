#!/usr/bin/env node
/**
 * Validación local del backend de TEINS con un PostgreSQL real en memoria (PGlite).
 *
 *   npm run backend:validate      (o: node supabase/tests/validate.mjs)
 *
 * Qué hace:
 *   1. Crea un "stub" mínimo de lo que Supabase trae de serie y PGlite no:
 *      roles anon/authenticated/service_role, auth.users, auth.uid() (lee el
 *      claim `sub` de `request.jwt.claims`, igual que Supabase) y el esquema
 *      storage (buckets, objects con RLS y storage.foldername).
 *   2. Ejecuta TODAS las migraciones de supabase/migrations dos veces
 *      (idempotencia) y el seed tres veces (sin usuarios y con usuarios).
 *   3. Simula dos técnicos, la oficina y un usuario anónimo con
 *      `SET ROLE` + claims del JWT y comprueba las políticas RLS con
 *      aserciones, reproduciendo las escrituras que hace la app (upsert de
 *      PostgREST = INSERT ... ON CONFLICT DO UPDATE, update y delete).
 *   4. Mejoras de noviembre de 2026 (migraciones 20261118*): restricciones y RLS
 *      de fotos con ubicación, materiales personalizados y varios formularios
 *      por visita; y, en una base aparte, la actualización de un proyecto que
 *      ya tiene datos (se aplican primero las migraciones antiguas, se cargan
 *      filas y después las nuevas dos veces: los datos se conservan y se
 *      transforman).
 *   5. Planos y figuras (migración 20261122000100): varios planos por visita,
 *      format_version, borrado de planos y la biblioteca de figuras de cada
 *      técnico (annotation_figures) con su RLS.
 *   6. Inventario (migración 20261122000200): RLS de material_stock y
 *      material_stock_movements, cuentas de los triggers (compras, ajustes y
 *      uso en visitas; los personalizados no cuentan), min_stock y el relleno
 *      de existencias desde los datos que ya había.
 *
 * No se conecta a ningún servicio externo. PGlite se usa desde
 * node_modules si está instalado; si no, se instala UNA vez en una carpeta
 * temporal del sistema (fuera del proyecto) y se reutiliza.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const PGLITE_VERSION = '0.5.13';
const HERE = dirname(fileURLToPath(import.meta.url));
const SUPABASE_DIR = resolve(HERE, '..');
const ROOT = resolve(SUPABASE_DIR, '..');

// ── PGlite ──────────────────────────────────────────────────────────────────

async function loadPGlite() {
  try {
    // Opcional: solo existe si alguien lo instaló en el proyecto.
    // eslint-disable-next-line import/no-unresolved
    return (await import('@electric-sql/pglite')).PGlite;
  } catch {
    // No está en el proyecto: se usa (o instala) una copia en la carpeta temporal.
  }
  const dir = join(tmpdir(), `teins-pglite-${PGLITE_VERSION}`);
  const pkg = join(dir, 'node_modules', '@electric-sql', 'pglite', 'package.json');
  if (!existsSync(pkg)) {
    console.log(`Instalando PGlite ${PGLITE_VERSION} en ${dir} (solo la primera vez)...`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"teins-pglite","private":true}\n');
    execSync(`npm install --no-audit --no-fund --silent @electric-sql/pglite@${PGLITE_VERSION}`, {
      cwd: dir,
      stdio: 'inherit',
    });
  }
  const require = createRequire(join(dir, 'package.json'));
  const entry = require.resolve('@electric-sql/pglite').replace(/index\.cjs$/, 'index.js');
  return (await import(pathToFileURL(entry).href)).PGlite;
}

// ── Stub de Supabase (auth + storage + roles) ──────────────────────────────

const SUPABASE_STUB = `
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Igual que Supabase: el id sale del claim "sub" del JWT de la petición.
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  public             BOOLEAN DEFAULT FALSE,
  file_size_limit    BIGINT,
  allowed_mime_types TEXT[],
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE storage.objects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  TEXT REFERENCES storage.buckets(id),
  name       TEXT NOT NULL,
  owner_id   TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO authenticated, service_role;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT ON storage.buckets TO anon, authenticated;
-- Misma definición que la función de Supabase Storage.
CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts TEXT[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END
$$;
GRANT EXECUTE ON FUNCTION storage.foldername(TEXT) TO anon, authenticated, service_role;
`;

// ── Utilidades de prueba ────────────────────────────────────────────────────

let passed = 0;
const failures = [];
const notes = [];

function check(condition, description, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${description}`);
  } else {
    failures.push(description);
    console.log(`  ✗ ${description}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/**
 * Ejecuta `fn(tx)` en una transacción como el rol indicado (simulando una
 * petición de PostgREST con ese JWT) y la deshace o confirma.
 * Devuelve { value, error }.
 */
async function as(db, who, fn, { commit = true } = {}) {
  try {
    const value = await db.transaction(async (tx) => {
      if (who.role) {
        const claims = JSON.stringify(
          who.uid ? { sub: who.uid, role: who.role } : { role: who.role },
        );
        await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
        await tx.exec(`SET LOCAL ROLE ${who.role}`);
      }
      const result = await fn(tx);
      if (!commit) await tx.rollback();
      return result;
    });
    return { value, error: null };
  } catch (error) {
    return { value: null, error };
  }
}

/** Upsert como el de PostgREST/supabase-js: INSERT ... ON CONFLICT (id) DO UPDATE. */
function upsertSql(table, row) {
  const cols = Object.keys(row);
  const values = cols.map((_, i) => `$${i + 1}`);
  const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`);
  return {
    sql: `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${values.join(', ')})
          ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}`,
    params: cols.map((c) => row[c]),
  };
}

async function upsert(tx, table, row) {
  const { sql, params } = upsertSql(table, row);
  return tx.query(sql, params);
}

const count = async (tx, sql, params = []) =>
  Number((await tx.query(`SELECT count(*)::int AS n FROM (${sql}) q`, params)).rows[0].n);

const ok = (result) => result.error === null;
const denied = (result) =>
  result.error !== null && /row-level security|permission denied/i.test(result.error.message);
const errMsg = (result) => (result.error ? result.error.message : 'sin error');

function migrationFiles() {
  const dir = join(SUPABASE_DIR, 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), 'utf8') }));
}

// ── Pruebas ────────────────────────────────────────────────────────────────

async function main() {
  const PGlite = await loadPGlite();
  const db = new PGlite();
  const seedSql = readFileSync(join(SUPABASE_DIR, 'seed.sql'), 'utf8');
  const assetTemplates = JSON.parse(
    readFileSync(join(ROOT, 'src', 'assets', 'form_templates.json'), 'utf8'),
  );

  section('1. Migraciones');
  await db.exec(SUPABASE_STUB);
  for (const round of [1, 2]) {
    for (const { name, sql } of migrationFiles()) {
      try {
        await db.exec(sql);
        check(true, `${round === 1 ? 'Aplica' : 'Re-aplica (idempotente)'} ${name}`);
      } catch (error) {
        check(false, `${round === 1 ? 'Aplica' : 'Re-aplica'} ${name}`, error.message);
      }
    }
  }

  section('2. Seed sin usuarios demo (no debe fallar)');
  let seed = await as(db, {}, (tx) => tx.exec(seedSql));
  check(ok(seed), 'El seed se ejecuta sin usuarios en auth.users', errMsg(seed));
  const base = await as(db, {}, async (tx) => ({
    types: await count(tx, 'SELECT 1 FROM public.visit_types'),
    templates: await count(tx, 'SELECT 1 FROM public.form_templates'),
    materials: await count(tx, 'SELECT 1 FROM public.material_catalog'),
    profiles: await count(tx, 'SELECT 1 FROM public.profiles'),
    visits: await count(tx, 'SELECT 1 FROM public.visits'),
  }));
  check(base.value?.types === 5, '5 tipos de visita', JSON.stringify(base.value));
  check(base.value?.templates === 5, '5 plantillas');
  check(base.value?.materials === 14, '14 materiales');
  check(
    base.value?.profiles === 0 && base.value?.visits === 0,
    'Sin usuarios: 0 perfiles y 0 visitas',
  );

  section('3. Usuarios, trigger handle_new_user y seed con usuarios');
  const users = await as(db, {}, async (tx) => {
    const ins = async (email, appMeta = {}, userMeta = {}) =>
      (
        await tx.query(
          `INSERT INTO auth.users (email, raw_app_meta_data, raw_user_meta_data)
           VALUES ($1, $2, $3) RETURNING id`,
          [email, JSON.stringify(appMeta), JSON.stringify(userMeta)],
        )
      ).rows[0].id;
    return {
      tech1: await ins('tecnico@teins.com', {}, { full_name: 'Carlos' }),
      office: await ins('oficina@teins.com'),
      tech2: await ins('tecnico2@teins.com', { role: 'technician' }),
      // Intenta auto-asignarse admin desde user_metadata (lo controla el usuario).
      sneaky: await ins('intruso@teins.com', {}, { role: 'admin' }),
      admin: await ins('admin@teins.com', { role: 'admin' }),
    };
  });
  check(ok(users), 'Se crean usuarios en auth.users', errMsg(users));
  const U = users.value;
  const roles = await as(db, {}, async (tx) =>
    Object.fromEntries(
      (await tx.query('SELECT email, role FROM public.profiles')).rows.map((r) => [
        r.email,
        r.role,
      ]),
    ),
  );
  check(roles.value?.['tecnico@teins.com'] === 'technician', 'El trigger crea el perfil');
  check(
    roles.value?.['intruso@teins.com'] === 'technician',
    'user_metadata.role = admin NO concede admin (se ignora)',
  );
  check(roles.value?.['admin@teins.com'] === 'admin', 'app_metadata.role = admin sí se respeta');

  for (const round of [1, 2]) {
    seed = await as(db, {}, (tx) => tx.exec(seedSql));
    check(ok(seed), `Seed con usuarios, ejecución ${round}`, errMsg(seed));
  }
  const afterSeed = await as(db, {}, async (tx) => ({
    office: (await tx.query(`SELECT role FROM public.profiles WHERE id = $1`, [U.office])).rows[0]
      ?.role,
    visits: await count(tx, 'SELECT 1 FROM public.visits WHERE technician_id = $1', [U.tech1]),
    templates: await count(tx, 'SELECT 1 FROM public.form_templates'),
    materials: await count(tx, 'SELECT 1 FROM public.material_catalog'),
    types: await count(tx, 'SELECT 1 FROM public.visit_types'),
    rows: (
      await tx.query('SELECT visit_type, name, version, sections_json FROM public.form_templates')
    ).rows,
  }));
  const S = afterSeed.value;
  check(S.office === 'office', 'El seed pone el rol office a oficina@teins.com');
  check(S.visits === 3, '3 visitas demo del técnico (sin duplicados al repetir)', `${S.visits}`);
  check(
    S.templates === 5 && S.materials === 14 && S.types === 5,
    'Re-ejecutar el seed no duplica catálogos',
  );
  for (const asset of assetTemplates) {
    const row = S.rows.find((r) => r.visit_type === asset.visit_type);
    check(
      row &&
        row.name === asset.name &&
        row.version === asset.version &&
        // JSONB reordena las claves: se compara el contenido, no el texto.
        isDeepStrictEqual(row.sections_json, asset.sections),
      `Plantilla "${asset.visit_type}" idéntica a src/assets/form_templates.json`,
    );
  }

  const T1 = { role: 'authenticated', uid: U.tech1 };
  const T2 = { role: 'authenticated', uid: U.tech2 };
  const OFF = { role: 'authenticated', uid: U.office };
  const ADM = { role: 'authenticated', uid: U.admin };
  const ANON = { role: 'anon' };
  const V1 = '20000000-0000-4000-8000-000000000001';
  const now = new Date().toISOString();

  section('4. Visitas');
  let r = await as(db, T1, (tx) => count(tx, 'SELECT 1 FROM public.visits'));
  check(r.value === 3, 'Técnico 1 ve sus 3 visitas', `${r.value} ${errMsg(r)}`);
  r = await as(db, T2, (tx) => count(tx, 'SELECT 1 FROM public.visits'));
  check(r.value === 0, 'Técnico 2 no ve visitas ajenas');

  const T2_VISIT = '50000000-0000-4000-8000-000000000001';
  const newVisit = {
    id: T2_VISIT,
    technician_id: U.tech2,
    title: 'Visita creada en el móvil',
    description: null,
    visit_type: 'general',
    address: 'Calle 1',
    status: 'assigned',
    sync_status: 'synced',
    created_at: now,
    updated_at: now,
  };
  r = await as(db, T2, (tx) => upsert(tx, 'visits', newVisit));
  check(ok(r), 'Técnico 2 crea su visita (upsert)', errMsg(r));
  r = await as(db, T2, (tx) => upsert(tx, 'visits', { ...newVisit, status: 'inProgress' }));
  check(ok(r), 'Técnico 2 repite el upsert de su visita (UPDATE vía ON CONFLICT)', errMsg(r));
  r = await as(db, T2, (tx) =>
    upsert(tx, 'visits', {
      ...newVisit,
      id: '50000000-0000-4000-8000-000000000002',
      technician_id: U.tech1,
    }),
  );
  check(denied(r), 'Técnico 2 NO puede crear visitas a nombre de otro', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(
      `UPDATE public.visits SET status = 'completed', completed_at = now(), started_at = now(),
         sync_status = 'synced' WHERE id = $1`,
      [V1],
    ),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Técnico 1 actualiza su visita (PATCH)', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.visits SET title = 'x' WHERE id = $1`, [T2_VISIT]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 1 NO modifica visitas ajenas (0 filas)');
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.visits SET technician_id = $1 WHERE id = $2`, [U.tech2, V1]),
  );
  check(denied(r), 'Técnico 1 NO puede reasignar su visita a otro técnico', errMsg(r));
  r = await as(db, T1, (tx) => tx.query(`DELETE FROM public.visits WHERE id = $1`, [V1]));
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 1 NO puede borrar visitas (0 filas)');
  r = await as(db, OFF, (tx) => tx.query(`DELETE FROM public.visits WHERE id = $1`, [V1]));
  check(ok(r) && r.value.affectedRows === 0, 'Oficina NO puede borrar visitas');
  r = await as(db, ADM, (tx) => tx.query(`DELETE FROM public.visits WHERE id = $1`, [V1]), {
    commit: false,
  });
  check(ok(r) && r.value.affectedRows === 1, 'Admin sí puede borrar visitas (deshecho)');

  section('5. Escrituras de la app en tablas hijas (técnico 1, visita propia)');
  const fr = {
    id: '60000000-0000-4000-8000-000000000001',
    visit_id: V1,
    template_id: '10000000-0000-4000-8000-000000000001',
    template_version: 1,
    responses: JSON.stringify({ ubicacion: 'Bodega 3', __template_key: null }),
    sync_status: 'synced',
    is_complete: false,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'form_responses', fr));
  check(ok(r), 'Upsert de form_responses (alta)', errMsg(r));
  r = await as(db, T1, (tx) => upsert(tx, 'form_responses', { ...fr, is_complete: true }));
  check(ok(r), 'Upsert de form_responses (modificación)', errMsg(r));

  const vm = {
    id: '60000000-0000-4000-8000-000000000002',
    visit_id: V1,
    material_id: '40000000-0000-4000-8000-000000000001',
    material_code: 'CABLE-UTP-CAT6',
    material_name: 'Cable UTP Cat6',
    unit: 'metro',
    quantity: 12.5,
    observations: null,
    sync_status: 'synced',
    created_at: now,
    updated_at: now,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'visit_materials', vm));
  check(ok(r), 'Upsert de visit_materials', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.visit_materials SET quantity = 3 WHERE id = $1`, [vm.id]),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Update de visit_materials');

  const photo = {
    id: '60000000-0000-4000-8000-000000000003',
    visit_id: V1,
    form_field_id: null,
    local_path: 'teins_photos/x.jpg',
    storage_path: null,
    storage_url: null,
    caption: null,
    sync_status: 'uploading',
    captured_at: now,
    uploaded_at: null,
    file_size_bytes: 1000,
    width: 800,
    height: 600,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'photos', photo));
  check(ok(r), "Upsert de photos con sync_status 'uploading'", errMsg(r));
  const path = `visits/${V1}/photos/${photo.id}.jpg`;
  r = await as(db, T1, (tx) =>
    tx.query(
      `UPDATE public.photos SET sync_status = 'uploaded', storage_path = $1, storage_url = $2,
         uploaded_at = now() WHERE id = $3`,
      [path, `https://ejemplo.invalid/storage/v1/object/visit-photos/${path}`, photo.id],
    ),
  );
  check(ok(r) && r.value.affectedRows === 1, "Update de photos a 'uploaded' con ruta y URL");

  const ann = {
    id: '60000000-0000-4000-8000-000000000004',
    visit_id: V1,
    title: 'Plano',
    elements: JSON.stringify([{ type: 'line' }]),
    base_image_path: null,
    canvas_width: 300,
    canvas_height: 200,
    sync_status: 'synced',
    created_at: now,
    updated_at: now,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'annotations', ann));
  check(ok(r), 'Upsert de annotations', errMsg(r));
  r = await as(db, T1, (tx) => upsert(tx, 'annotations', { ...ann, title: 'Plano 2' }));
  check(ok(r), 'Upsert de annotations (modificación)', errMsg(r));

  section('6. Aislamiento entre técnicos');
  for (const table of ['form_responses', 'visit_materials', 'photos', 'annotations']) {
    r = await as(db, T2, (tx) => count(tx, `SELECT 1 FROM public.${table}`));
    check(r.value === 0, `Técnico 2 no ve ${table} del técnico 1`);
    r = await as(db, T2, (tx) =>
      tx.query(`UPDATE public.${table} SET sync_status = sync_status WHERE visit_id = $1`, [V1]),
    );
    check(ok(r) && r.value.affectedRows === 0, `Técnico 2 no modifica ${table} ajenos`);
  }
  r = await as(db, T2, (tx) =>
    upsert(tx, 'form_responses', { ...fr, id: '60000000-0000-4000-8000-000000000099' }),
  );
  check(denied(r), 'Técnico 2 NO inserta respuestas en una visita ajena', errMsg(r));
  r = await as(db, T2, (tx) =>
    upsert(tx, 'photos', { ...photo, id: '60000000-0000-4000-8000-000000000098' }),
  );
  check(denied(r), 'Técnico 2 NO inserta fotos en una visita ajena', errMsg(r));
  r = await as(db, T2, (tx) => tx.query(`DELETE FROM public.photos WHERE id = $1`, [photo.id]));
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 2 NO borra fotos ajenas');
  r = await as(db, T2, (tx) => tx.query(`DELETE FROM public.annotations WHERE id = $1`, [ann.id]));
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 2 NO borra planos de otro técnico');

  section('7. Borrados permitidos y no permitidos');
  r = await as(db, T1, (tx) =>
    tx.query(`DELETE FROM public.form_responses WHERE id = $1`, [fr.id]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO borra form_responses (la app no lo hace)');
  r = await as(db, T1, (tx) => tx.query(`DELETE FROM public.annotations WHERE id = $1`, [ann.id]), {
    commit: false,
  });
  check(
    ok(r) && r.value.affectedRows === 1,
    'Técnico borra un plano de su visita (deshecho)',
    errMsg(r),
  );
  r = await as(db, T1, (tx) =>
    tx.query(`DELETE FROM public.visit_materials WHERE id = $1`, [vm.id]),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Técnico borra un material de su visita');
  r = await as(db, T1, (tx) => tx.query(`DELETE FROM public.photos WHERE id = $1`, [photo.id]), {
    commit: false,
  });
  check(ok(r) && r.value.affectedRows === 1, 'Técnico borra una foto de su visita');

  section('8. Catálogos y plantillas');
  r = await as(db, T1, async (tx) => ({
    m: await count(tx, 'SELECT 1 FROM public.material_catalog'),
    t: await count(tx, 'SELECT 1 FROM public.form_templates'),
    v: await count(tx, 'SELECT 1 FROM public.visit_types'),
  }));
  check(
    r.value?.m === 14 && r.value?.t === 5 && r.value?.v === 5,
    'Técnico lee catálogo, plantillas y tipos activos',
  );
  r = await as(db, T1, (tx) =>
    tx.query(
      `INSERT INTO public.material_catalog (code, name, unit) VALUES ('X-1', 'X', 'unidad')`,
    ),
  );
  check(denied(r), 'Técnico NO crea materiales de catálogo', errMsg(r));
  r = await as(db, T1, (tx) => tx.query(`UPDATE public.form_templates SET name = 'x'`));
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO modifica plantillas');
  r = await as(db, T1, (tx) => tx.query(`DELETE FROM public.visit_types`));
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO borra tipos de visita');
  await as(db, ADM, (tx) =>
    tx.query(`UPDATE public.form_templates SET is_active = FALSE WHERE visit_type = 'ups'`),
  );
  r = await as(db, T1, (tx) => count(tx, 'SELECT 1 FROM public.form_templates'));
  check(r.value === 4, 'Una plantilla desactivada (por el admin) deja de verse');
  await as(db, ADM, (tx) =>
    tx.query(`UPDATE public.form_templates SET is_active = TRUE WHERE visit_type = 'ups'`),
  );

  section('9. Perfiles');
  r = await as(db, T1, (tx) => count(tx, 'SELECT 1 FROM public.profiles'));
  check(r.value === 1, 'Técnico solo ve su perfil');
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.profiles SET full_name = 'Carlos P.', phone = '1' WHERE id = $1`, [
      U.tech1,
    ]),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Técnico edita nombre y teléfono propios');
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.profiles SET role = 'admin' WHERE id = $1`, [U.tech1]),
  );
  check(denied(r), 'Técnico NO puede cambiarse el rol', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.profiles SET is_active = FALSE WHERE id = $1`, [U.tech1]),
  );
  check(denied(r), 'Técnico NO puede cambiar su is_active', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.profiles SET full_name = 'x' WHERE id = $1`, [U.tech2]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO edita perfiles ajenos');

  section('10. Oficina');
  r = await as(db, OFF, async (tx) => ({
    visits: await count(tx, 'SELECT 1 FROM public.visits'),
    profiles: await count(tx, 'SELECT 1 FROM public.profiles'),
    fr: await count(tx, 'SELECT 1 FROM public.form_responses'),
    vm: await count(tx, 'SELECT 1 FROM public.visit_materials'),
    ph: await count(tx, 'SELECT 1 FROM public.photos'),
    an: await count(tx, 'SELECT 1 FROM public.annotations'),
  }));
  check(
    r.value?.visits === 4 && r.value?.profiles === 5,
    'Oficina lee todas las visitas y perfiles',
    JSON.stringify(r.value),
  );
  check(
    r.value?.fr === 1 && r.value?.ph === 1 && r.value?.an === 1 && r.value?.vm === 0,
    'Oficina lee respuestas, fotos y anotaciones de todos',
    JSON.stringify(r.value),
  );

  section('11. Usuario anónimo');
  for (const table of [
    'profiles',
    'visit_types',
    'form_templates',
    'visits',
    'form_responses',
    'material_catalog',
    'visit_materials',
    'photos',
    'annotations',
    'annotation_figures',
    'material_stock',
    'material_stock_movements',
    'audit_logs',
  ]) {
    r = await as(db, ANON, (tx) => count(tx, `SELECT 1 FROM public.${table}`));
    check(denied(r) || r.value === 0, `Anónimo no lee ${table}`, errMsg(r));
  }
  r = await as(db, ANON, (tx) => count(tx, `SELECT 1 FROM storage.objects`));
  check(denied(r) || r.value === 0, 'Anónimo no lee objetos de Storage');
  r = await as(db, { role: 'authenticated' }, (tx) => count(tx, 'SELECT 1 FROM public.visits'));
  check(r.value === 0, 'Autenticado sin uid no ve visitas');

  section('12. Storage (bucket visit-photos)');
  const bucket = await as(
    db,
    {},
    async (tx) =>
      (await tx.query(`SELECT * FROM storage.buckets WHERE id = 'visit-photos'`)).rows[0],
  );
  const b = bucket.value;
  check(
    b &&
      b.public === false &&
      Number(b.file_size_limit) === 5 * 1024 * 1024 &&
      JSON.stringify(b.allowed_mime_types) ===
        JSON.stringify(['image/jpeg', 'image/png', 'image/webp']),
    'Bucket privado, 5 MB, JPEG/PNG/WebP',
  );
  const upload = (tx, name) =>
    tx.query(
      `INSERT INTO storage.objects (bucket_id, name) VALUES ('visit-photos', $1)
       ON CONFLICT (bucket_id, name) DO UPDATE SET updated_at = now()`,
      [name],
    );
  r = await as(db, T1, (tx) => upload(tx, path));
  check(ok(r), 'Técnico sube una foto a visits/<su visita>/photos/', errMsg(r));
  r = await as(db, T1, (tx) => upload(tx, path));
  check(ok(r), 'Técnico re-sube (upsert) la misma foto', errMsg(r));
  r = await as(db, T1, (tx) => upload(tx, `visits/${T2_VISIT}/photos/x.jpg`));
  check(denied(r), 'Técnico NO sube a la carpeta de una visita ajena', errMsg(r));
  r = await as(db, T1, (tx) => upload(tx, `otra/${V1}/photos/x.jpg`));
  check(denied(r), 'Técnico NO sube fuera de la ruta visits/<id>/photos/', errMsg(r));
  r = await as(db, T1, (tx) => upload(tx, `visits/no-es-uuid/photos/x.jpg`));
  check(denied(r), 'Ruta con id inválido: se rechaza sin error de conversión', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE storage.objects SET name = $1 WHERE name = $2`, [
      `visits/${T2_VISIT}/photos/robada.jpg`,
      path,
    ]),
  );
  check(denied(r), 'Técnico NO mueve un objeto a una ruta ajena', errMsg(r));
  r = await as(db, T1, (tx) => count(tx, 'SELECT 1 FROM storage.objects'));
  check(r.value === 1, 'Técnico 1 ve su foto');
  r = await as(db, T2, (tx) => count(tx, 'SELECT 1 FROM storage.objects'));
  check(r.value === 0, 'Técnico 2 NO ve fotos ajenas');
  r = await as(db, OFF, (tx) => count(tx, 'SELECT 1 FROM storage.objects'));
  check(r.value === 1, 'Oficina ve todas las fotos');
  r = await as(db, T1, (tx) => tx.query(`DELETE FROM storage.objects WHERE name = $1`, [path]));
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO borra objetos remotos');

  await validateImprovementsRls(db, { T1, T2, OFF, V1, T2_VISIT, now });
  await validatePlansAndFigures(db, { T1, T2, OFF, ANON, V1, now });
  await validateInventory(db, { T1, T2, OFF, ADM, ANON, V1, now });

  section('17. Estructura, funciones y PowerSync');
  const meta = await as(db, {}, async (tx) => ({
    noRls: (
      await tx.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
      )
    ).rows,
    definerNoPath: (
      await tx.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public', 'private') AND p.prosecdef
           AND NOT coalesce(p.proconfig::text LIKE '%search_path%', false)`,
      )
    ).rows,
    enumPhoto: (await tx.query(`SELECT unnest(enum_range(NULL::public.photo_sync_status))::text v`))
      .rows,
    enumSync: (await tx.query(`SELECT unnest(enum_range(NULL::public.sync_status))::text v`)).rows,
    publicFns: (
      await tx.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname IN ('is_technician','is_admin_or_office','get_user_role')`,
      )
    ).rows,
  }));
  const M = meta.value;
  check(
    M.noRls.length === 0,
    'RLS activada en todas las tablas de public',
    JSON.stringify(M.noRls),
  );
  check(
    M.definerNoPath.length === 0,
    'Toda función SECURITY DEFINER tiene search_path fijo',
    JSON.stringify(M.definerNoPath),
  );
  check(M.publicFns.length === 0, 'Las funciones auxiliares no están expuestas en public');
  check(
    JSON.stringify(M.enumPhoto.map((x) => x.v)) ===
      JSON.stringify(['local', 'pendingUpload', 'uploading', 'uploaded', 'uploadError']),
    'Enum photo_sync_status = estados que usa la app (incluido uploading)',
  );
  for (const state of ['local', 'pendingSync', 'syncing', 'synced', 'syncError']) {
    check(
      M.enumSync.some((x) => x.v === state),
      `Enum sync_status admite '${state}' (estados de upload.ts)`,
    );
  }

  const ps = await as(db, {}, async (tx) => ({
    pub: (
      await tx.query(`SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync'`)
    ).rows.map((x) => x.tablename),
    role: (
      await tx.query(
        `SELECT rolreplication, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'powersync_role'`,
      )
    ).rows[0],
    selects: (
      await tx.query(
        `SELECT table_name FROM information_schema.role_table_grants
         WHERE grantee = 'powersync_role' AND privilege_type = 'SELECT'`,
      )
    ).rows.map((x) => x.table_name),
  }));
  const expected = [
    'annotation_figures',
    'annotations',
    'form_responses',
    'form_templates',
    'material_catalog',
    'material_stock',
    'material_stock_movements',
    'photos',
    'profiles',
    'visit_materials',
    'visit_types',
    'visits',
  ];
  if (ok(ps)) {
    check(
      JSON.stringify([...ps.value.pub].sort()) === JSON.stringify(expected),
      'Publicación powersync con exactamente las 12 tablas',
      JSON.stringify(ps.value.pub),
    );
    const role = ps.value.role;
    check(
      role && role.rolreplication && role.rolbypassrls && role.rolcanlogin,
      'powersync_role con REPLICATION, BYPASSRLS y LOGIN',
    );
    check(
      JSON.stringify([...ps.value.selects].sort()) === JSON.stringify(expected),
      'powersync_role solo tiene SELECT en las 12 tablas (no audit_logs)',
      JSON.stringify(ps.value.selects),
    );
  } else {
    notes.push(`No se pudo consultar la publicación en PGlite: ${errMsg(ps)}`);
  }
  notes.push(
    'PGlite no hace replicación lógica real (wal_level, slots): la conexión de PowerSync solo se puede probar contra Supabase.',
  );

  await validateUpgradeWithExistingData(PGlite);

  // ── Resumen ──
  console.log(`\nResultado: ${passed} comprobaciones correctas, ${failures.length} fallidas.`);
  for (const note of notes) console.log(`Nota: ${note}`);
  await db.close();
  if (failures.length > 0) {
    console.log('\nFallaron:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

// ── Mejoras de noviembre de 2026 (migraciones 20261118*) ───────────────────

const NEW_MIGRATIONS_PREFIXES = ['20261118', '20261122'];
const isNewMigration = (name) => NEW_MIGRATIONS_PREFIXES.some((prefix) => name.startsWith(prefix));
const violates = (result, name) =>
  result.error !== null && new RegExp(name, 'i').test(result.error.message);

/**
 * Restricciones nuevas y RLS de las tres mejoras sobre la base ya migrada:
 * fotos con ubicación, materiales personalizados y varios formularios.
 */
async function validateImprovementsRls(db, { T1, T2, OFF, V1, T2_VISIT, now }) {
  section('13. Fotos con marca de tiempo y ubicación');
  const photo = {
    id: '70000000-0000-4000-8000-000000000001',
    visit_id: V1,
    form_field_id: null,
    local_path: 'teins_photos/marca.jpg',
    storage_path: null,
    storage_url: null,
    caption: null,
    sync_status: 'local',
    captured_at: now,
    uploaded_at: null,
    file_size_bytes: 1000,
    width: 1920,
    height: 1080,
    latitude: -3.993421,
    longitude: -79.204512,
    location_accuracy: 8,
    taken_at: now,
  };
  let r = await as(db, T1, (tx) => upsert(tx, 'photos', photo));
  check(ok(r), 'Técnico sube una foto con coordenadas, precisión y hora impresa', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(
      'SELECT latitude, longitude, location_accuracy, taken_at FROM public.photos WHERE id = $1',
      [photo.id],
    ),
  );
  const storedPhoto = r.value?.rows[0];
  check(
    storedPhoto?.latitude === -3.993421 &&
      storedPhoto?.longitude === -79.204512 &&
      storedPhoto?.location_accuracy === 8 &&
      storedPhoto?.taken_at instanceof Date,
    'Las columnas de ubicación conservan los valores (DOUBLE PRECISION y TIMESTAMPTZ)',
    JSON.stringify(storedPhoto),
  );
  r = await as(db, T1, (tx) =>
    upsert(tx, 'photos', {
      ...photo,
      id: '70000000-0000-4000-8000-000000000002',
      latitude: null,
      longitude: null,
      location_accuracy: null,
    }),
  );
  check(ok(r), 'Foto sin ubicación ("Ubicación no disponible"): se acepta con NULL', errMsg(r));
  for (const [label, changes] of [
    ['latitud fuera de rango', { latitude: 95 }],
    ['longitud fuera de rango', { longitude: -181 }],
    ['solo latitud, sin longitud', { longitude: null }],
    ['precisión negativa', { location_accuracy: -1 }],
  ]) {
    r = await as(db, T1, (tx) =>
      upsert(tx, 'photos', { ...photo, id: '70000000-0000-4000-8000-000000000003', ...changes }),
    );
    check(violates(r, 'chk_photo_location'), `Se rechaza una foto con ${label}`, errMsg(r));
  }

  section('14. Materiales personalizados (solo en la visita)');
  const custom = {
    id: '70000000-0000-4000-8000-000000000010',
    visit_id: V1,
    material_id: null,
    is_custom: true,
    material_code: 'PERSONALIZADO',
    material_name: 'Abrazadera especial',
    unit: 'unidad',
    quantity: 3,
    observations: null,
    sync_status: 'synced',
    created_at: now,
    updated_at: now,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'visit_materials', custom));
  check(ok(r), 'Técnico agrega un material personalizado a su visita (upsert)', errMsg(r));
  r = await as(db, T1, (tx) => upsert(tx, 'visit_materials', { ...custom, quantity: 4 }));
  check(ok(r), 'Técnico repite el upsert del personalizado (UPDATE vía ON CONFLICT)', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.visit_materials SET quantity = 5, observations = 'x' WHERE id = $1`, [
      custom.id,
    ]),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Técnico edita su material personalizado (PATCH)');
  r = await as(db, T1, (tx) =>
    upsert(tx, 'visit_materials', {
      ...custom,
      id: '70000000-0000-4000-8000-000000000011',
      material_name: '  ABRAZADERA especial ',
    }),
  );
  check(
    violates(r, 'uq_visit_material_custom'),
    'Dos personalizados con el mismo nombre y unidad en la visita: se rechaza',
    errMsg(r),
  );
  r = await as(db, T1, (tx) =>
    upsert(tx, 'visit_materials', {
      ...custom,
      id: '70000000-0000-4000-8000-000000000012',
      unit: 'caja',
    }),
  );
  check(ok(r), 'Mismo nombre con otra unidad: se acepta', errMsg(r));
  r = await as(db, T1, (tx) =>
    upsert(tx, 'visit_materials', {
      ...custom,
      id: '70000000-0000-4000-8000-000000000013',
      material_id: '40000000-0000-4000-8000-000000000001',
    }),
  );
  check(
    violates(r, 'chk_visit_material_source'),
    'Un personalizado no puede apuntar al catálogo',
    errMsg(r),
  );
  r = await as(db, T1, (tx) =>
    upsert(tx, 'visit_materials', {
      ...custom,
      id: '70000000-0000-4000-8000-000000000014',
      is_custom: false,
    }),
  );
  check(
    violates(r, 'chk_visit_material_source'),
    'Un material del catálogo sin material_id se rechaza',
    errMsg(r),
  );
  r = await as(db, T1, (tx) =>
    upsert(tx, 'visit_materials', {
      ...custom,
      id: '70000000-0000-4000-8000-000000000015',
      material_name: '   ',
    }),
  );
  check(
    violates(r, 'chk_visit_material_custom_text'),
    'Un personalizado sin nombre se rechaza',
    errMsg(r),
  );
  r = await as(db, T1, (tx) =>
    upsert(tx, 'visit_materials', {
      ...custom,
      id: '70000000-0000-4000-8000-000000000016',
      material_name: 'Otro',
      unit: 'x'.repeat(21),
    }),
  );
  check(
    violates(r, 'chk_visit_material_custom_text'),
    'Un personalizado con unidad de más de 20 caracteres se rechaza',
    errMsg(r),
  );
  r = await as(db, T1, (tx) =>
    upsert(tx, 'visit_materials', {
      id: '70000000-0000-4000-8000-000000000017',
      visit_id: V1,
      material_id: '40000000-0000-4000-8000-000000000001',
      material_code: 'CABLE-UTP-CAT6',
      material_name: 'Cable UTP Cat6',
      unit: 'metro',
      quantity: 2,
      observations: null,
      sync_status: 'synced',
      created_at: now,
      updated_at: now,
    }),
  );
  check(
    ok(r),
    'Un material del catálogo sin is_custom (app anterior) sigue funcionando',
    errMsg(r),
  );
  r = await as(db, T2, (tx) =>
    upsert(tx, 'visit_materials', { ...custom, id: '70000000-0000-4000-8000-000000000018' }),
  );
  check(denied(r), 'Técnico 2 NO agrega personalizados en una visita ajena', errMsg(r));
  r = await as(db, T2, (tx) =>
    tx.query(`UPDATE public.visit_materials SET quantity = 9 WHERE id = $1`, [custom.id]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 2 NO edita personalizados ajenos');
  r = await as(db, T2, (tx) =>
    tx.query(`DELETE FROM public.visit_materials WHERE id = $1`, [custom.id]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 2 NO borra personalizados ajenos');
  r = await as(db, T2, (tx) =>
    upsert(tx, 'visit_materials', {
      ...custom,
      id: '70000000-0000-4000-8000-000000000019',
      visit_id: T2_VISIT,
    }),
  );
  check(ok(r), 'Técnico 2 agrega el mismo personalizado en SU visita (no choca)', errMsg(r));
  r = await as(db, OFF, (tx) => count(tx, 'SELECT 1 FROM public.visit_materials WHERE is_custom'));
  check(r.value === 3, 'Oficina lee los materiales personalizados de todos', `${r.value}`);
  r = await as(db, T1, (tx) =>
    tx.query(`DELETE FROM public.visit_materials WHERE id = $1`, [custom.id]),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Técnico quita su material personalizado');
  r = await as(db, T1, (tx) =>
    count(tx, 'SELECT 1 FROM public.material_catalog WHERE code = $1', ['PERSONALIZADO']),
  );
  check(r.value === 0, 'El catálogo no cambia: no se crean materiales de catálogo');

  section('15. Varios formularios por visita (uno por plantilla)');
  const base = {
    visit_id: V1,
    template_version: 1,
    sync_status: 'synced',
    is_complete: false,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  const assetForm = {
    ...base,
    id: '70000000-0000-4000-8000-000000000020',
    template_id: null,
    template_key: 'ups_cdp_v1',
    responses: JSON.stringify({ equipo: 'UPS', __template_key: 'ups_cdp_v1' }),
  };
  r = await as(db, T1, (tx) => upsert(tx, 'form_responses', assetForm));
  check(ok(r), 'Segundo formulario en la misma visita con otra plantilla (asset)', errMsg(r));
  r = await as(db, T1, (tx) =>
    count(tx, 'SELECT 1 FROM public.form_responses WHERE visit_id = $1', [V1]),
  );
  check(r.value === 2, 'La visita tiene 2 formularios', `${r.value}`);
  r = await as(db, T1, (tx) =>
    upsert(tx, 'form_responses', {
      ...assetForm,
      id: '70000000-0000-4000-8000-000000000021',
    }),
  );
  check(
    violates(r, 'uq_form_response_visit_template'),
    'Un segundo formulario con la MISMA plantilla en la visita se rechaza',
    errMsg(r),
  );
  // App anterior: no envía template_key → el trigger lo calcula.
  r = await as(db, T1, async (tx) => {
    await upsert(tx, 'form_responses', {
      ...base,
      id: '70000000-0000-4000-8000-000000000022',
      template_id: '10000000-0000-4000-8000-000000000002',
      responses: JSON.stringify({ a: 1 }),
    });
    await upsert(tx, 'form_responses', {
      ...base,
      id: '70000000-0000-4000-8000-000000000023',
      template_id: null,
      responses: JSON.stringify({ b: 2, __template_key: 'teins_visita_v1' }),
    });
    return (
      await tx.query(
        `SELECT id, template_key FROM public.form_responses
         WHERE id IN ('70000000-0000-4000-8000-000000000022', '70000000-0000-4000-8000-000000000023')
         ORDER BY id`,
      )
    ).rows.map((row) => row.template_key);
  });
  check(
    ok(r) &&
      JSON.stringify(r.value) ===
        JSON.stringify(['10000000-0000-4000-8000-000000000002', 'teins_visita_v1']),
    'Sin template_key (app anterior) se calcula desde template_id o __template_key',
    `${JSON.stringify(r.value)} ${errMsg(r)}`,
  );
  r = await as(db, T1, async (tx) => {
    await upsert(tx, 'form_responses', { ...assetForm, template_key: null, is_complete: true });
    return (
      await tx.query('SELECT template_key, is_complete FROM public.form_responses WHERE id = $1', [
        assetForm.id,
      ])
    ).rows[0];
  });
  check(
    ok(r) && r.value?.template_key === 'ups_cdp_v1' && r.value?.is_complete === true,
    'Un upsert con template_key NULL no borra la clave (se vuelve a calcular)',
    `${JSON.stringify(r.value)} ${errMsg(r)}`,
  );
  r = await as(db, T2, (tx) =>
    upsert(tx, 'form_responses', {
      ...assetForm,
      id: '70000000-0000-4000-8000-000000000024',
      template_key: 'otra',
    }),
  );
  check(denied(r), 'Técnico 2 NO agrega formularios en una visita ajena', errMsg(r));
  r = await as(db, T2, (tx) =>
    upsert(tx, 'form_responses', {
      ...assetForm,
      id: '70000000-0000-4000-8000-000000000025',
      visit_id: T2_VISIT,
    }),
  );
  check(ok(r), 'Técnico 2 usa la misma plantilla en SU visita (no choca)', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query('DELETE FROM public.form_responses WHERE id = $1', [assetForm.id]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico sigue sin poder borrar formularios');
}

// ── Planos y figuras (migración 20261122000100) ────────────────────────────

/**
 * Varios planos por visita, format_version, borrado de planos y la biblioteca
 * de figuras de cada técnico (annotation_figures), sobre la base ya migrada.
 */
async function validatePlansAndFigures(db, { T1, T2, OFF, ANON, V1, now }) {
  section('16. Varios planos por visita y biblioteca de figuras');
  const plan = {
    id: '90000000-0000-4000-8000-000000000001',
    visit_id: V1,
    title: 'Planta baja',
    elements: JSON.stringify([]),
    base_image_path: null,
    canvas_width: 300,
    canvas_height: 200,
    sync_status: 'synced',
    created_at: now,
    updated_at: now,
  };
  const secondPlan = '90000000-0000-4000-8000-000000000002';
  const v2Plan = '90000000-0000-4000-8000-000000000003';
  let r = await as(db, T1, async (tx) => {
    await upsert(tx, 'annotations', plan);
    await upsert(tx, 'annotations', { ...plan, id: secondPlan, title: 'Planta alta' });
    return count(tx, 'SELECT 1 FROM public.annotations WHERE id = ANY($1)', [
      [plan.id, secondPlan],
    ]);
  });
  check(ok(r) && r.value === 2, 'Dos planos en la misma visita ya se permiten', errMsg(r));
  r = await as(
    db,
    T1,
    async (tx) =>
      (await tx.query('SELECT format_version FROM public.annotations WHERE id = $1', [plan.id]))
        .rows[0],
  );
  check(r.value?.format_version === 1, 'format_version por defecto = 1', JSON.stringify(r.value));
  r = await as(db, T1, (tx) =>
    upsert(tx, 'annotations', { ...plan, id: v2Plan, format_version: 2 }),
  );
  check(ok(r), 'Se guarda un plano con format_version 2', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.annotations SET format_version = 3 WHERE id = $1', [plan.id]),
  );
  check(
    violates(r, 'ck_annotation_format_version'),
    'format_version = 3 se rechaza (CHECK)',
    errMsg(r),
  );
  r = await as(db, T2, (tx) =>
    upsert(tx, 'annotations', { ...plan, id: '90000000-0000-4000-8000-000000000004' }),
  );
  check(denied(r), 'Técnico 2 NO crea planos en una visita ajena', errMsg(r));
  r = await as(db, T2, (tx) => tx.query('DELETE FROM public.annotations WHERE id = $1', [v2Plan]));
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 2 NO borra planos ajenos (0 filas)');
  r = await as(db, T1, (tx) => tx.query('DELETE FROM public.annotations WHERE id = $1', [v2Plan]));
  check(ok(r) && r.value.affectedRows === 1, 'Técnico borra un plano de su visita', errMsg(r));

  const figure = {
    id: '90000000-0000-4000-8000-000000000010',
    technician_id: T1.uid,
    name: 'Rack 42U',
    elements: JSON.stringify([{ type: 'rect', x: 0, y: 0, w: 60, h: 200 }]),
    width: 60,
    height: 200,
    sync_status: 'synced',
    created_at: now,
    updated_at: now,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'annotation_figures', figure));
  check(ok(r), 'Técnico 1 crea una figura (upsert)', errMsg(r));
  r = await as(db, T1, (tx) => upsert(tx, 'annotation_figures', { ...figure, width: 61 }));
  check(ok(r), 'Técnico 1 repite el upsert de su figura (UPDATE vía ON CONFLICT)', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(`UPDATE public.annotation_figures SET name = 'Rack 42U (frente)' WHERE id = $1`, [
      figure.id,
    ]),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Técnico 1 modifica su figura (PATCH)', errMsg(r));
  r = await as(
    db,
    T1,
    async (tx) =>
      (await tx.query('SELECT name, elements, width FROM public.annotation_figures')).rows,
  );
  check(
    ok(r) &&
      r.value.length === 1 &&
      r.value[0].name === 'Rack 42U (frente)' &&
      r.value[0].width === 61 &&
      Array.isArray(r.value[0].elements),
    'Técnico 1 lee su figura',
    `${JSON.stringify(r.value)} ${errMsg(r)}`,
  );
  r = await as(db, T2, (tx) => count(tx, 'SELECT 1 FROM public.annotation_figures'));
  check(ok(r) && r.value === 0, 'Técnico 2 NO ve las figuras del técnico 1', errMsg(r));
  r = await as(db, OFF, (tx) => count(tx, 'SELECT 1 FROM public.annotation_figures'));
  check(ok(r) && r.value === 0, 'Oficina NO ve las figuras de los técnicos', errMsg(r));
  r = await as(db, T2, (tx) =>
    tx.query(`UPDATE public.annotation_figures SET name = 'x' WHERE id = $1`, [figure.id]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 2 NO modifica figuras ajenas (0 filas)');
  r = await as(db, T2, (tx) =>
    tx.query('DELETE FROM public.annotation_figures WHERE id = $1', [figure.id]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico 2 NO borra figuras ajenas (0 filas)');
  r = await as(db, T2, (tx) =>
    upsert(tx, 'annotation_figures', { ...figure, id: '90000000-0000-4000-8000-000000000011' }),
  );
  check(denied(r), 'Técnico 2 NO crea figuras a nombre de otro', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.annotation_figures SET technician_id = $1 WHERE id = $2', [
      T2.uid,
      figure.id,
    ]),
  );
  check(denied(r), 'Técnico 1 NO pasa su figura a otro técnico', errMsg(r));
  r = await as(db, T2, (tx) =>
    upsert(tx, 'annotation_figures', {
      ...figure,
      id: '90000000-0000-4000-8000-000000000012',
      technician_id: T2.uid,
    }),
  );
  check(ok(r), 'Técnico 2 crea su propia figura (mismo nombre, no choca)', errMsg(r));
  for (const [label, name] of [
    ['vacío', ''],
    ['solo espacios', '   '],
    ['de 61 caracteres', 'x'.repeat(61)],
  ]) {
    r = await as(db, T1, (tx) =>
      upsert(tx, 'annotation_figures', {
        ...figure,
        id: '90000000-0000-4000-8000-000000000013',
        name,
      }),
    );
    check(
      violates(r, 'ck_annotation_figure_name'),
      `Nombre de figura ${label} rechazado`,
      errMsg(r),
    );
  }
  r = await as(db, ANON, (tx) => count(tx, 'SELECT 1 FROM public.annotation_figures'));
  check(denied(r), 'Anónimo no tiene acceso a annotation_figures', errMsg(r));
  r = await as(db, ANON, (tx) =>
    upsert(tx, 'annotation_figures', { ...figure, id: '90000000-0000-4000-8000-000000000014' }),
  );
  check(denied(r), 'Anónimo NO crea figuras', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query('DELETE FROM public.annotation_figures WHERE id = $1', [figure.id]),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Técnico 1 borra su figura', errMsg(r));
}

/**
 * Inventario (migración 20261122000200): RLS, cuentas de los triggers y min_stock.
 * Las cuentas se comprueban como diferencias respecto al estado anterior, para
 * no depender de lo que dejaron las secciones previas.
 */
async function validateInventory(db, { T1, T2, OFF, ADM, ANON, V1, now }) {
  section('19. Inventario de bodega (material_stock y material_stock_movements)');
  const M = '40000000-0000-4000-8000-000000000002';
  const M2 = '40000000-0000-4000-8000-000000000003';
  const stockOf = async (materialId) =>
    (
      await as(
        db,
        {},
        async (tx) =>
          (
            await tx.query(
              `SELECT purchased::float8 AS purchased, adjusted::float8 AS adjusted,
                      used::float8 AS used, on_hand::float8 AS on_hand
               FROM public.material_stock WHERE material_id = $1`,
              [materialId],
            )
          ).rows[0] ?? null,
      )
    ).value;
  // Diferencias redondeadas a 3 decimales (NUMERIC(…, 3) leído como float8).
  const round = (value) => Math.round(value * 1000) / 1000;
  const delta = (after, before) => ({
    purchased: round(after.purchased - before.purchased),
    adjusted: round(after.adjusted - before.adjusted),
    used: round(after.used - before.used),
    on_hand: round(after.on_hand - before.on_hand),
  });
  const same = (actual, expected) => isDeepStrictEqual(actual, expected);
  const totalUsed = async () =>
    (
      await as(
        db,
        {},
        async (tx) =>
          (await tx.query('SELECT sum(used)::float8 AS u FROM public.material_stock')).rows[0].u,
      )
    ).value;

  let r = await as(db, {}, async (tx) => ({
    catalog: await count(tx, 'SELECT 1 FROM public.material_catalog'),
    stock: await count(tx, 'SELECT 1 FROM public.material_stock'),
    broken: await count(
      tx,
      'SELECT 1 FROM public.material_stock WHERE on_hand <> purchased + adjusted - used',
    ),
  }));
  check(
    ok(r) && r.value.catalog === r.value.stock && r.value.broken === 0,
    'Cada material del catálogo tiene su fila de existencias (también los del seed)',
    JSON.stringify(r.value),
  );

  // ── RLS ──
  r = await as(db, T1, (tx) => count(tx, 'SELECT 1 FROM public.material_stock'));
  check(ok(r) && r.value === 14, 'Técnico lee las existencias', `${r.value} ${errMsg(r)}`);
  r = await as(db, T1, (tx) => count(tx, 'SELECT 1 FROM public.material_stock_movements'));
  check(ok(r), 'Técnico lee los movimientos de bodega', errMsg(r));
  r = await as(db, { role: 'authenticated', uid: '99999999-0000-4000-8000-000000000001' }, (tx) =>
    count(tx, 'SELECT 1 FROM public.material_stock'),
  );
  check(ok(r) && r.value === 0, 'Usuario sin perfil no ve existencias', errMsg(r));

  const movement = {
    id: 'a0000000-0000-4000-8000-000000000001',
    material_id: M,
    kind: 'purchase',
    quantity: 100,
    note: 'Factura 001-123',
    created_by: T1.uid,
    sync_status: 'synced',
    created_at: now,
    updated_at: now,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'material_stock_movements', movement));
  check(denied(r), 'Técnico NO registra compras (RLS)', errMsg(r));
  r = await as(db, OFF, (tx) =>
    upsert(tx, 'material_stock_movements', { ...movement, created_by: ADM.uid }),
  );
  check(denied(r), 'Oficina NO registra movimientos a nombre de otro', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query(
      `INSERT INTO public.material_stock (material_id, purchased, on_hand) VALUES ($1, 1, 1)
       ON CONFLICT (material_id) DO UPDATE SET purchased = 999, on_hand = 999`,
      [M],
    ),
  );
  check(denied(r), 'Técnico NO escribe en material_stock', errMsg(r));
  r = await as(db, ADM, (tx) =>
    tx.query(
      'UPDATE public.material_stock SET purchased = 999, on_hand = 999 WHERE material_id = $1',
      [M],
    ),
  );
  check(denied(r), 'Ni el admin escribe en material_stock (solo los triggers)', errMsg(r));
  r = await as(db, T1, (tx) => tx.query('SELECT private.apply_stock_delta($1, 1, 0, 0)', [M]));
  check(denied(r), 'Las funciones de los triggers no se pueden llamar desde la API', errMsg(r));

  // ── Compras y ajustes ──
  const s0 = await stockOf(M);
  r = await as(db, OFF, (tx) =>
    upsert(tx, 'material_stock_movements', { ...movement, created_by: OFF.uid }),
  );
  check(ok(r), 'Oficina registra una compra (upsert como la app)', errMsg(r));
  let s1 = await stockOf(M);
  check(
    same(delta(s1, s0), { purchased: 100, adjusted: 0, used: 0, on_hand: 100 }),
    'Compra de 100: purchased +100 y on_hand +100',
    JSON.stringify({ s0, s1 }),
  );
  r = await as(db, OFF, (tx) =>
    upsert(tx, 'material_stock_movements', { ...movement, created_by: OFF.uid }),
  );
  s1 = await stockOf(M);
  check(
    ok(r) && delta(s1, s0).on_hand === 100,
    'Repetir el mismo upsert (reintento de subida) no duplica la compra',
    `${JSON.stringify({ s0, s1 })} ${errMsg(r)}`,
  );

  const adjustment = {
    ...movement,
    id: 'a0000000-0000-4000-8000-000000000002',
    kind: 'adjustment',
    quantity: -5.5,
    note: 'Conteo físico',
    created_by: ADM.uid,
  };
  r = await as(db, ADM, (tx) => upsert(tx, 'material_stock_movements', adjustment));
  check(ok(r), 'Admin registra un ajuste negativo', errMsg(r));
  s1 = await stockOf(M);
  check(
    same(delta(s1, s0), { purchased: 100, adjusted: -5.5, used: 0, on_hand: 94.5 }),
    'Ajuste de −5,5: adjusted −5,5 y on_hand +94,5 en total',
    JSON.stringify({ s0, s1 }),
  );

  r = await as(db, OFF, (tx) =>
    tx.query('UPDATE public.material_stock_movements SET quantity = 80 WHERE id = $1', [
      movement.id,
    ]),
  );
  s1 = await stockOf(M);
  check(
    ok(r) && same(delta(s1, s0), { purchased: 80, adjusted: -5.5, used: 0, on_hand: 74.5 }),
    'Corregir la compra a 80 recalcula las existencias',
    `${JSON.stringify({ s0, s1 })} ${errMsg(r)}`,
  );
  const m2s0 = await stockOf(M2);
  r = await as(db, OFF, (tx) =>
    tx.query(
      `UPDATE public.material_stock_movements SET kind = 'adjustment', material_id = $1
       WHERE id = $2`,
      [M2, movement.id],
    ),
  );
  s1 = await stockOf(M);
  const m2s1 = await stockOf(M2);
  check(
    ok(r) &&
      same(delta(s1, s0), { purchased: 0, adjusted: -5.5, used: 0, on_hand: -5.5 }) &&
      same(delta(m2s1, m2s0), { purchased: 0, adjusted: 80, used: 0, on_hand: 80 }),
    'Cambiar tipo y material de un movimiento mueve su cantidad al material nuevo',
    `${JSON.stringify({ s0, s1, m2s0, m2s1 })} ${errMsg(r)}`,
  );
  r = await as(db, OFF, (tx) =>
    tx.query(
      `UPDATE public.material_stock_movements SET kind = 'purchase', material_id = $1
       WHERE id = $2`,
      [M, movement.id],
    ),
  );
  check(
    ok(r) && same(delta(await stockOf(M2), m2s0).on_hand, 0),
    'Se deshace el cambio de tipo y material',
    errMsg(r),
  );

  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.material_stock_movements SET quantity = 1 WHERE id = $1', [
      movement.id,
    ]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO modifica movimientos (0 filas)');
  r = await as(db, T1, (tx) =>
    tx.query('DELETE FROM public.material_stock_movements WHERE id = $1', [movement.id]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO borra movimientos (0 filas)');

  for (const [label, row, constraint] of [
    ['compra de 0', { kind: 'purchase', quantity: 0 }, 'chk_stock_movement_quantity'],
    ['compra negativa', { kind: 'purchase', quantity: -1 }, 'chk_stock_movement_quantity'],
    ['ajuste de 0', { kind: 'adjustment', quantity: 0 }, 'chk_stock_movement_quantity'],
    ['tipo desconocido', { kind: 'gift', quantity: 1 }, 'chk_stock_movement_kind'],
    ['nota de 501 caracteres', { note: 'x'.repeat(501) }, 'chk_stock_movement_note'],
  ]) {
    r = await as(db, OFF, (tx) =>
      upsert(tx, 'material_stock_movements', {
        ...movement,
        id: 'a0000000-0000-4000-8000-000000000099',
        created_by: OFF.uid,
        ...row,
      }),
    );
    check(violates(r, constraint), `Movimiento rechazado: ${label}`, errMsg(r));
  }

  // ── Uso en visitas ──
  const s2 = await stockOf(M);
  const use = {
    id: 'a0000000-0000-4000-8000-000000000010',
    visit_id: V1,
    material_id: M,
    is_custom: false,
    material_code: 'CABLE-THHN-12',
    material_name: 'Cable THHN #12 AWG',
    unit: 'metro',
    quantity: 10,
    observations: null,
    sync_status: 'synced',
    created_at: now,
    updated_at: now,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'visit_materials', use));
  check(ok(r), 'Técnico registra material del catálogo en su visita', errMsg(r));
  let s3 = await stockOf(M);
  check(
    same(delta(s3, s2), { purchased: 0, adjusted: 0, used: 10, on_hand: -10 }),
    'Uso de 10 en la visita: used +10 y on_hand −10 (el trigger escribe aunque el técnico no pueda)',
    JSON.stringify({ s2, s3 }),
  );
  r = await as(db, T1, (tx) => upsert(tx, 'visit_materials', use));
  s3 = await stockOf(M);
  check(
    ok(r) && delta(s3, s2).used === 10,
    'Repetir el upsert del mismo material no duplica el uso',
    errMsg(r),
  );
  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.visit_materials SET quantity = 4 WHERE id = $1', [use.id]),
  );
  s3 = await stockOf(M);
  check(
    ok(r) && same(delta(s3, s2), { purchased: 0, adjusted: 0, used: 4, on_hand: -4 }),
    'Cambiar la cantidad a 4 ajusta el uso',
    JSON.stringify({ s2, s3 }),
  );
  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.visit_materials SET observations = $1 WHERE id = $2', ['x', use.id]),
  );
  s3 = await stockOf(M);
  check(ok(r) && delta(s3, s2).used === 4, 'Cambiar solo las observaciones no cambia el uso');

  const m2s2 = await stockOf(M2);
  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.visit_materials SET material_id = $1 WHERE id = $2', [M2, use.id]),
  );
  s3 = await stockOf(M);
  const m2s3 = await stockOf(M2);
  check(
    ok(r) && delta(s3, s2).used === 0 && delta(m2s3, m2s2).used === 4,
    'Cambiar el material de la fila pasa el uso al material nuevo',
    `${JSON.stringify({ s2, s3, m2s2, m2s3 })} ${errMsg(r)}`,
  );
  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.visit_materials SET material_id = $1 WHERE id = $2', [M, use.id]),
  );
  check(
    ok(r) && delta(await stockOf(M2), m2s2).used === 0,
    'Se devuelve la fila al material original',
  );

  const usedBefore = await totalUsed();
  const customUse = {
    ...use,
    id: 'a0000000-0000-4000-8000-000000000011',
    material_id: null,
    is_custom: true,
    material_code: 'PERSONALIZADO',
    material_name: 'Cinta especial inventario',
    unit: 'rollo',
    quantity: 7,
  };
  r = await as(db, T1, (tx) => upsert(tx, 'visit_materials', customUse));
  check(ok(r), 'Técnico registra un material personalizado', errMsg(r));
  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.visit_materials SET quantity = 9 WHERE id = $1', [customUse.id]),
  );
  const usedAfter = await totalUsed();
  check(
    ok(r) && usedBefore === usedAfter,
    'Los materiales personalizados no cuentan en la bodega (alta ni cambio)',
    `${usedBefore} → ${usedAfter} ${errMsg(r)}`,
  );

  r = await as(
    db,
    ADM,
    async (tx) => {
      await tx.query('DELETE FROM public.visits WHERE id = $1', [V1]);
      return (
        await tx.query(
          'SELECT used::float8 AS used FROM public.material_stock WHERE material_id = $1',
          [M],
        )
      ).rows[0];
    },
    { commit: false },
  );
  check(
    ok(r) && round(r.value.used) === round(s2.used),
    'Borrar la visita (cascada) devuelve sus materiales a la bodega (deshecho)',
    `${JSON.stringify({ value: r.value, s2 })} ${errMsg(r)}`,
  );

  r = await as(db, T1, (tx) =>
    tx.query('DELETE FROM public.visit_materials WHERE id = ANY($1)', [[use.id, customUse.id]]),
  );
  s3 = await stockOf(M);
  check(
    ok(r) && same(delta(s3, s2), { purchased: 0, adjusted: 0, used: 0, on_hand: 0 }),
    'Quitar el material de la visita devuelve la cantidad a la bodega',
    JSON.stringify({ s2, s3 }),
  );

  r = await as(db, OFF, (tx) =>
    tx.query('DELETE FROM public.material_stock_movements WHERE id = ANY($1)', [
      [movement.id, adjustment.id],
    ]),
  );
  s3 = await stockOf(M);
  check(
    ok(r) &&
      r.value.affectedRows === 2 &&
      same(delta(s3, s0), { purchased: 0, adjusted: 0, used: 0, on_hand: 0 }),
    'Borrar los movimientos deja las existencias como estaban',
    `${JSON.stringify({ s0, s3 })} ${errMsg(r)}`,
  );

  // ── min_stock ──
  r = await as(db, ADM, (tx) =>
    tx.query('UPDATE public.material_catalog SET min_stock = 20 WHERE id = $1', [M]),
  );
  check(ok(r) && r.value.affectedRows === 1, 'Admin fija el mínimo de bodega', errMsg(r));
  r = await as(db, OFF, (tx) =>
    tx.query('UPDATE public.material_catalog SET min_stock = 1 WHERE id = $1', [M]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Oficina NO cambia el mínimo (0 filas)');
  r = await as(db, T1, (tx) =>
    tx.query('UPDATE public.material_catalog SET min_stock = 1 WHERE id = $1', [M]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO cambia el mínimo (0 filas)');
  r = await as(db, ADM, (tx) =>
    tx.query('UPDATE public.material_catalog SET min_stock = -1 WHERE id = $1', [M]),
  );
  check(violates(r, 'chk_material_min_stock'), 'Mínimo negativo rechazado', errMsg(r));
  r = await as(
    db,
    T1,
    async (tx) =>
      (
        await tx.query(
          'SELECT min_stock::float8 AS min_stock FROM public.material_catalog WHERE id = $1',
          [M],
        )
      ).rows[0],
  );
  check(r.value?.min_stock === 20, 'Técnico lee el mínimo', JSON.stringify(r.value));

  r = await as(
    db,
    ADM,
    async (tx) => {
      const { id } = (
        await tx.query(
          `INSERT INTO public.material_catalog (code, name, unit)
           VALUES ('INV-NUEVO', 'Nuevo', 'unidad') RETURNING id`,
        )
      ).rows[0];
      return (
        await tx.query(
          `SELECT on_hand::float8 AS on_hand, used::float8 AS used
           FROM public.material_stock WHERE material_id = $1`,
          [id],
        )
      ).rows[0];
    },
    { commit: false },
  );
  check(
    ok(r) && r.value?.on_hand === 0 && r.value?.used === 0,
    'Un material nuevo del catálogo nace con existencias en cero (deshecho)',
    `${JSON.stringify(r.value)} ${errMsg(r)}`,
  );

  r = await as(db, ANON, (tx) =>
    upsert(tx, 'material_stock_movements', {
      ...movement,
      id: 'a0000000-0000-4000-8000-000000000098',
    }),
  );
  check(denied(r), 'Anónimo NO registra movimientos', errMsg(r));
  r = await as(db, T2, (tx) => count(tx, 'SELECT 1 FROM public.material_stock'));
  check(ok(r) && r.value === 14, 'Cualquier técnico activo lee las existencias (bodega única)');
}

/**
 * Actualización de un proyecto que YA tiene datos: se aplican solo las
 * migraciones anteriores, se cargan filas como las de producción y después
 * las migraciones nuevas (dos veces). Las filas deben conservarse y
 * transformarse sin perder nada.
 */
async function validateUpgradeWithExistingData(PGlite) {
  section('18. Actualización de un proyecto con datos (migraciones 20261118* y 20261122*)');
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const all = migrationFiles();
  const previous = all.filter((m) => !isNewMigration(m.name));
  const added = all.filter((m) => isNewMigration(m.name));
  check(added.length === 6, 'Hay 6 migraciones nuevas', added.map((m) => m.name).join(', '));
  for (const { sql } of previous) await db.exec(sql);

  const OLD = '2026-05-01T10:00:00.000Z';
  const ids = {
    user: '80000000-0000-4000-8000-000000000001',
    visit: '80000000-0000-4000-8000-000000000002',
    visit2: '80000000-0000-4000-8000-000000000003',
    visit3: '80000000-0000-4000-8000-000000000004',
    template: '80000000-0000-4000-8000-000000000005',
    material: '80000000-0000-4000-8000-000000000006',
    frDb: '80000000-0000-4000-8000-000000000007',
    frAsset: '80000000-0000-4000-8000-000000000008',
    frOrphan: '80000000-0000-4000-8000-000000000009',
    vm: '80000000-0000-4000-8000-000000000010',
    photo: '80000000-0000-4000-8000-000000000011',
    annotation: '80000000-0000-4000-8000-000000000012',
  };
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${ids.user}', 'existente@teins.com');
    INSERT INTO public.form_templates (id, name, visit_type, version, sections_json)
      VALUES ('${ids.template}', 'Plantilla existente', 'general', 1, '[]');
    INSERT INTO public.material_catalog (id, code, name, unit)
      VALUES ('${ids.material}', 'MAT-EX', 'Material existente', 'metro');
    INSERT INTO public.visits (id, technician_id, title, visit_type, created_at, updated_at) VALUES
      ('${ids.visit}', '${ids.user}', 'Visita 1', 'general', '${OLD}', '${OLD}'),
      ('${ids.visit2}', '${ids.user}', 'Visita 2', 'ups', '${OLD}', '${OLD}'),
      ('${ids.visit3}', '${ids.user}', 'Visita 3', 'general', '${OLD}', '${OLD}');
    INSERT INTO public.form_responses (id, visit_id, template_id, template_version, responses,
        is_complete, created_at, updated_at) VALUES
      ('${ids.frDb}', '${ids.visit}', '${ids.template}', 1, '{"f1": "valor"}', TRUE, '${OLD}', '${OLD}'),
      ('${ids.frAsset}', '${ids.visit2}', NULL, 1,
        '{"equipo": "UPS", "__template_key": "ups_cdp_v1"}', FALSE, '${OLD}', '${OLD}'),
      ('${ids.frOrphan}', '${ids.visit3}', NULL, 1, '{"x": 1}', FALSE, '${OLD}', '${OLD}');
    INSERT INTO public.visit_materials (id, visit_id, material_id, material_code, material_name,
        unit, quantity, created_at, updated_at)
      VALUES ('${ids.vm}', '${ids.visit}', '${ids.material}', 'MAT-EX', 'Material existente',
        'metro', 12.5, '${OLD}', '${OLD}');
    INSERT INTO public.photos (id, visit_id, local_path, captured_at, width, height)
      VALUES ('${ids.photo}', '${ids.visit}', 'teins_photos/vieja.jpg', '${OLD}', 800, 600);
    INSERT INTO public.annotations (id, visit_id, title, elements, canvas_width, canvas_height,
        created_at, updated_at)
      VALUES ('${ids.annotation}', '${ids.visit}', 'Plano existente',
        '[{"type": "line", "points": [0.1, 0.2, 0.9, 0.8]}]', 300, 200, '${OLD}', '${OLD}');
  `);
  const snapshot = async () => ({
    fr: (
      await db.query(
        `SELECT id, visit_id, template_id, responses, is_complete, created_at, updated_at
         FROM public.form_responses ORDER BY id`,
      )
    ).rows,
    vm: (
      await db.query(
        `SELECT id, visit_id, material_id, material_code, material_name, unit, quantity::text,
                created_at, updated_at FROM public.visit_materials ORDER BY id`,
      )
    ).rows,
    ph: (
      await db.query(
        `SELECT id, visit_id, local_path, captured_at, width, height FROM public.photos ORDER BY id`,
      )
    ).rows,
    an: (
      await db.query(
        `SELECT id, visit_id, title, elements, canvas_width, canvas_height, created_at, updated_at
         FROM public.annotations ORDER BY id`,
      )
    ).rows,
  });
  const before = await snapshot();

  for (const round of [1, 2]) {
    for (const { name, sql } of added) {
      try {
        await db.exec(sql);
        check(true, `${round === 1 ? 'Aplica' : 'Re-aplica'} ${name} sobre datos existentes`);
      } catch (error) {
        check(false, `${round === 1 ? 'Aplica' : 'Re-aplica'} ${name}`, error.message);
      }
    }
  }

  const after = await snapshot();
  check(
    isDeepStrictEqual(after, before),
    'Respuestas, materiales, fotos y planos existentes se conservan intactos (incluido updated_at)',
    JSON.stringify({ before, after }),
  );
  const keys = Object.fromEntries(
    (await db.query('SELECT id, template_key FROM public.form_responses')).rows.map((row) => [
      row.id,
      row.template_key,
    ]),
  );
  check(keys[ids.frDb] === ids.template, 'template_key = template_id para plantillas de la base');
  check(
    keys[ids.frAsset] === 'ups_cdp_v1',
    'template_key = __template_key para plantillas del asset',
  );
  check(keys[ids.frOrphan] === null, 'Sin plantilla conocida, template_key queda en NULL');
  const vmRow = (await db.query('SELECT is_custom FROM public.visit_materials')).rows[0];
  check(vmRow?.is_custom === false, 'Los materiales existentes quedan como del catálogo');
  const photoRow = (
    await db.query('SELECT latitude, longitude, location_accuracy, taken_at FROM public.photos')
  ).rows[0];
  check(
    photoRow &&
      photoRow.latitude === null &&
      photoRow.longitude === null &&
      photoRow.location_accuracy === null &&
      photoRow.taken_at === null,
    'Las fotos existentes quedan sin marca (columnas nuevas en NULL)',
  );
  const constraints = (
    await db.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.form_responses'::regclass AND contype = 'u'`,
    )
  ).rows.map((row) => row.conname);
  check(
    !constraints.includes('uq_form_response_visit') &&
      constraints.includes('uq_form_response_visit_template'),
    'Se quita UNIQUE (visit_id) y queda UNIQUE (visit_id, template_key)',
    JSON.stringify(constraints),
  );
  const nullable = (
    await db.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'visit_materials' AND column_name = 'material_id'`,
    )
  ).rows[0]?.is_nullable;
  check(nullable === 'YES', 'visit_materials.material_id admite NULL');
  const annRow = (
    await db.query(`SELECT format_version FROM public.annotations WHERE id = '${ids.annotation}'`)
  ).rows[0];
  check(annRow?.format_version === 1, 'El plano existente queda con format_version 1');
  await db.query(
    `INSERT INTO public.annotations (id, visit_id, title)
     VALUES ('80000000-0000-4000-8000-000000000097', '${ids.visit}', 'Segundo plano')`,
  );
  check(
    (await db.query(`SELECT 1 FROM public.annotations WHERE visit_id = '${ids.visit}'`)).rows
      .length === 2,
    'Tras migrar, la visita con su plano antiguo admite un segundo plano',
  );
  let failed = null;
  try {
    await db.query(
      `INSERT INTO public.form_responses (id, visit_id, template_id, responses)
       VALUES ('80000000-0000-4000-8000-000000000099', '${ids.visit}', '${ids.template}', '{}')`,
    );
  } catch (error) {
    failed = error;
  }
  check(
    failed !== null && /uq_form_response_visit_template/.test(failed.message),
    'Tras migrar, una respuesta repetida de la misma plantilla sigue rechazándose',
    failed ? failed.message : 'sin error',
  );
  await db.query(
    `INSERT INTO public.form_responses (id, visit_id, template_id, template_key, responses)
     VALUES ('80000000-0000-4000-8000-000000000098', '${ids.visit}', NULL, 'ups_cdp_v1',
       '{"__template_key": "ups_cdp_v1"}')`,
  );
  check(
    (await db.query(`SELECT 1 FROM public.form_responses WHERE visit_id = '${ids.visit}'`)).rows
      .length === 2,
    'Tras migrar, la visita con su respuesta antigua admite un segundo formulario',
  );
  const stockRows = (
    await db.query(
      `SELECT material_id, purchased::float8 AS purchased, adjusted::float8 AS adjusted,
              used::float8 AS used, on_hand::float8 AS on_hand
       FROM public.material_stock`,
    )
  ).rows;
  check(
    stockRows.length === 1 &&
      stockRows[0].material_id === ids.material &&
      stockRows[0].purchased === 0 &&
      stockRows[0].adjusted === 0 &&
      stockRows[0].used === 12.5 &&
      stockRows[0].on_hand === -12.5,
    'Relleno: una fila de existencias por material, con el uso de las visitas existentes',
    JSON.stringify(stockRows),
  );
  await db.close();
}

main().catch((error) => {
  console.error('La validación no pudo ejecutarse:', error);
  process.exitCode = 1;
});
