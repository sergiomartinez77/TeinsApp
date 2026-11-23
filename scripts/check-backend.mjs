#!/usr/bin/env node
/**
 * Comprueba que el backend desplegado (Supabase + PowerSync) responde.
 *
 *   npm run backend:check      (o: node scripts/check-backend.mjs [ruta/.env])
 *
 * Lee SUPABASE_URL, SUPABASE_ANON_KEY y POWERSYNC_URL del archivo .env (o del
 * entorno, que tiene prioridad). SOLO LEE: no escribe nada en el backend.
 * Nunca imprime la clave.
 *
 * Comprueba:
 *   1. Que las variables existen y tienen formato válido.
 *   2. Que los nombres de dominio resuelven (DNS).
 *   3. La salud de Supabase Auth.
 *   4. Que las tablas sincronizadas existen vía la API REST (200, o 401/403 por RLS/permisos,
 *      es lo esperable; 404 o "tabla no encontrada" significa que faltan migraciones).
 *   5. El bucket visit-photos (si la clave pública puede consultarlo).
 *   6. Que PowerSync responde.
 */
import { Buffer } from 'node:buffer';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TABLES = [
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
];
const BUCKET = 'visit-photos';
const TIMEOUT_MS = 10_000;

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failures += 1;
  console.log(`  ✗ ${msg}`);
};
const info = (msg) => console.log(`  · ${msg}`);

/** Lector mínimo de .env (CLAVE=valor, comentarios con #, comillas opcionales). */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

/** Tipo de clave sin revelarla. */
function describeKey(key) {
  if (key.startsWith('sb_publishable_')) return { kind: 'publicable (sb_publishable_…)' };
  if (key.startsWith('sb_secret_')) return { kind: 'SECRETA', secret: true };
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') return { kind: 'service_role', secret: true };
      if (payload.role === 'anon') return { kind: 'anon heredada (JWT)', jwt: true };
      return { kind: `JWT con rol "${payload.role ?? '?'}"`, jwt: true };
    } catch {
      return { kind: 'desconocido', invalid: true };
    }
  }
  return { kind: 'desconocido', invalid: true };
}

/** Explica en español por qué falló una petición (sin trazas). */
function explain(error) {
  const code = error?.cause?.code ?? error?.code ?? '';
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
    return `sin respuesta en ${TIMEOUT_MS / 1000} s`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'el nombre de dominio no existe';
  if (code === 'ECONNREFUSED') return 'conexión rechazada';
  if (code === 'ECONNRESET') return 'la conexión se cortó';
  if (String(code).startsWith('CERT') || String(code).includes('TLS'))
    return 'certificado TLS no válido';
  return 'no se pudo conectar';
}

async function request(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  return { status: response.status, body };
}

function parseUrl(name, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url;
  } catch {
    bad(`${name} no es una URL válida`);
    return null;
  }
}

async function resolves(name, url) {
  try {
    await lookup(url.hostname);
    ok(`${name}: ${url.hostname} resuelve`);
    return true;
  } catch {
    bad(
      `${name}: ${url.hostname} NO resuelve (DNS). El proyecto/instancia no existe o la URL está mal. ` +
        'Crea el backend nuevo (docs/BACKEND.md) y actualiza .env.',
    );
    return false;
  }
}

async function main() {
  const envPath = resolve(process.argv[2] ?? '.env');
  const fileEnv = readEnvFile(envPath);
  const env = (key) => (process.env[key] ?? fileEnv[key] ?? '').trim();

  console.log('Comprobación del backend de TEINS (solo lectura)');
  console.log(
    existsSync(envPath) ? `Archivo: ${envPath}` : `Aviso: no existe ${envPath}; se usa el entorno.`,
  );

  console.log('\n1. Variables');
  const supabaseRaw = env('SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY');
  const powersyncRaw = env('POWERSYNC_URL');
  for (const [name, value] of [
    ['SUPABASE_URL', supabaseRaw],
    ['SUPABASE_ANON_KEY', key],
    ['POWERSYNC_URL', powersyncRaw],
  ]) {
    if (value) ok(`${name} definida`);
    else bad(`${name} vacía o ausente`);
  }
  const supabaseUrl = supabaseRaw ? parseUrl('SUPABASE_URL', supabaseRaw) : null;
  const powersyncUrl = powersyncRaw ? parseUrl('POWERSYNC_URL', powersyncRaw) : null;
  let keyInfo = null;
  if (key) {
    keyInfo = describeKey(key);
    if (keyInfo.secret)
      bad(
        `SUPABASE_ANON_KEY es una clave ${keyInfo.kind}: NUNCA debe ir en la app. ` +
          'Usa la clave publicable o la anon.',
      );
    else if (keyInfo.invalid) bad('SUPABASE_ANON_KEY no tiene un formato de clave de Supabase');
    else ok(`Tipo de clave: ${keyInfo.kind}`);
  }

  console.log('\n2. Resolución de nombres (DNS)');
  const supabaseUp = supabaseUrl ? await resolves('Supabase', supabaseUrl) : false;
  const powersyncUp = powersyncUrl ? await resolves('PowerSync', powersyncUrl) : false;

  const base = supabaseUrl ? supabaseUrl.origin : '';
  const headers = key && !keyInfo?.secret ? { apikey: key } : {};
  // La clave anon heredada es un JWT y también va como Bearer; la publicable no.
  if (keyInfo?.jwt) headers.Authorization = `Bearer ${key}`;

  console.log('\n3. Supabase Auth');
  if (!supabaseUp) info('Se omite: Supabase no resuelve.');
  else {
    try {
      const res = await request(`${base}/auth/v1/health`, headers);
      if (res.status === 200) ok('Auth responde (HTTP 200)');
      else if (res.status === 401)
        bad('Auth rechaza la clave (HTTP 401): revisa SUPABASE_ANON_KEY');
      else bad(`Auth responde HTTP ${res.status}`);
    } catch (error) {
      bad(`Auth: ${explain(error)}`);
    }
  }

  console.log('\n4. Tablas (API REST)');
  if (!supabaseUp) info('Se omite: Supabase no resuelve.');
  else {
    for (const table of TABLES) {
      try {
        const res = await request(`${base}/rest/v1/${table}?select=id&limit=1`, headers);
        const missing = res.status === 404 || /PGRST205|42P01|does not exist/.test(res.body);
        if (missing) bad(`${table}: no existe (¿faltan las migraciones?)`);
        else if (res.status === 200) ok(`${table}: existe (HTTP 200)`);
        else if (res.status === 401 || res.status === 403)
          ok(`${table}: existe y está protegida (HTTP ${res.status}, esperable sin sesión)`);
        else bad(`${table}: HTTP ${res.status} inesperado`);
      } catch (error) {
        bad(`${table}: ${explain(error)}`);
      }
    }
  }

  console.log('\n5. Storage');
  if (!supabaseUp) info('Se omite: Supabase no resuelve.');
  else {
    try {
      const res = await request(`${base}/storage/v1/bucket/${BUCKET}`, headers);
      if (res.status === 200) ok(`Bucket ${BUCKET} existe`);
      else
        info(
          `Bucket ${BUCKET}: no consultable con la clave pública (HTTP ${res.status}). ` +
            'Es normal en un bucket privado; compruébalo en el panel (Storage).',
        );
    } catch (error) {
      bad(`Storage: ${explain(error)}`);
    }
  }

  console.log('\n6. PowerSync');
  if (!powersyncUp) info('Se omite: PowerSync no resuelve.');
  else {
    try {
      const res = await request(`${powersyncUrl.origin}/probes/liveness`);
      if (res.status < 500) ok(`PowerSync responde (HTTP ${res.status})`);
      else bad(`PowerSync responde con error (HTTP ${res.status})`);
    } catch (error) {
      bad(`PowerSync: ${explain(error)}`);
    }
  }

  console.log(
    failures === 0
      ? '\nTodo correcto.'
      : `\n${failures} problema(s). Guía paso a paso: docs/BACKEND.md`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(() => {
  console.log('\n✗ La comprobación no pudo terminar por un error inesperado.');
  process.exitCode = 1;
});
