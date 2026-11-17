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

  section('7. Borrados permitidos y no permitidos');
  r = await as(db, T1, (tx) =>
    tx.query(`DELETE FROM public.form_responses WHERE id = $1`, [fr.id]),
  );
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO borra form_responses (la app no lo hace)');
  r = await as(db, T1, (tx) => tx.query(`DELETE FROM public.annotations WHERE id = $1`, [ann.id]));
  check(ok(r) && r.value.affectedRows === 0, 'Técnico NO borra annotations (la app no lo hace)');
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

  section('13. Estructura, funciones y PowerSync');
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
    'annotations',
    'form_responses',
    'form_templates',
    'material_catalog',
    'photos',
    'profiles',
    'visit_materials',
    'visit_types',
    'visits',
  ];
  if (ok(ps)) {
    check(
      JSON.stringify([...ps.value.pub].sort()) === JSON.stringify(expected),
      'Publicación powersync con exactamente las 9 tablas',
      JSON.stringify(ps.value.pub),
    );
    const role = ps.value.role;
    check(
      role && role.rolreplication && role.rolbypassrls && role.rolcanlogin,
      'powersync_role con REPLICATION, BYPASSRLS y LOGIN',
    );
    check(
      JSON.stringify([...ps.value.selects].sort()) === JSON.stringify(expected),
      'powersync_role solo tiene SELECT en las 9 tablas (no audit_logs)',
      JSON.stringify(ps.value.selects),
    );
  } else {
    notes.push(`No se pudo consultar la publicación en PGlite: ${errMsg(ps)}`);
  }
  notes.push(
    'PGlite no hace replicación lógica real (wal_level, slots): la conexión de PowerSync solo se puede probar contra Supabase.',
  );

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

main().catch((error) => {
  console.error('La validación no pudo ejecutarse:', error);
  process.exitCode = 1;
});
