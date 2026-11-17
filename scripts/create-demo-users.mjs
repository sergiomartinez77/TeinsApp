#!/usr/bin/env node
/**
 * Crea los usuarios demo de TEINS en Supabase Auth (alternativa al panel).
 *
 *   tecnico@teins.com  (rol technician)
 *   oficina@teins.com  (rol office)
 *
 * Uso (PowerShell):
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<clave secreta del panel>"
 *   $env:DEMO_PASSWORD = "<contraseña para los dos usuarios>"
 *   node scripts/create-demo-users.mjs
 *   Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:DEMO_PASSWORD
 *
 * Uso (Git Bash / macOS / Linux):
 *   SUPABASE_SERVICE_ROLE_KEY="..." DEMO_PASSWORD="..." node scripts/create-demo-users.mjs
 *
 * SEGURIDAD: la clave secreta (service_role o sb_secret_…) salta todas las
 * reglas de seguridad. Este script SOLO la lee de una variable de entorno de
 * tu terminal: no la escribas en .env, ni en EAS, ni en el repositorio.
 * SUPABASE_URL se toma del entorno o, si no está, de .env.
 *
 * El rol se guarda en app_metadata (no lo puede cambiar el usuario); el
 * trigger handle_new_user crea el perfil con ese rol. Después ejecuta
 * supabase/seed.sql para cargar los nombres y las 3 visitas demo.
 */
import { existsSync, readFileSync } from 'node:fs';

const USERS = [
  { email: 'tecnico@teins.com', role: 'technician', fullName: 'Carlos Técnico Demo' },
  { email: 'oficina@teins.com', role: 'office', fullName: 'Ana Oficina Demo' },
];

function fromDotEnv(key) {
  if (!existsSync('.env')) return '';
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${key}=`));
  return line
    ? line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    : '';
}

async function main() {
  const url = (process.env.SUPABASE_URL || fromDotEnv('SUPABASE_URL')).replace(/\/+$/, '');
  const secret = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const password = process.env.DEMO_PASSWORD ?? '';

  if (!url) throw new Error('Falta SUPABASE_URL (en el entorno o en .env).');
  if (!secret) throw new Error('Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY.');
  if (password.length < 8) throw new Error('DEMO_PASSWORD debe tener al menos 8 caracteres.');

  const headers = { apikey: secret, 'Content-Type': 'application/json' };
  // La clave service_role heredada es un JWT y va también como Bearer.
  if (secret.split('.').length === 3) headers.Authorization = `Bearer ${secret}`;

  for (const user of USERS) {
    const response = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: user.email,
        password,
        email_confirm: true,
        app_metadata: { role: user.role },
        user_metadata: { full_name: user.fullName },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (response.ok) console.log(`✓ Creado ${user.email} (${user.role})`);
    else if (response.status === 422 || /already|exists|registered/i.test(body))
      console.log(`· ${user.email} ya existía (sin cambios)`);
    else console.log(`✗ ${user.email}: HTTP ${response.status}`);
  }
  console.log('\nSiguiente paso: ejecuta supabase/seed.sql en el editor SQL del panel.');
}

main().catch((error) => {
  console.log(`✗ ${error instanceof Error ? error.message : 'Error inesperado'}`);
  process.exitCode = 1;
});
