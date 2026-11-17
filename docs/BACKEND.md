# Backend: Supabase + PowerSync desde cero

Esta guía explica cómo crear el backend de TEINS en un **proyecto Supabase nuevo** y una
**instancia PowerSync nueva**, sin experiencia previa. Todo lo que hay que crear está en
el repositorio:

| Carpeta / archivo               | Qué es                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `supabase/migrations/*.sql`     | Esquema, permisos (RLS), Storage y replicación. Se aplican **en orden**        |
| `supabase/seed.sql`             | Datos demo: tipos de visita, 5 plantillas, 14 materiales, perfiles y 3 visitas |
| `supabase/config.toml`          | Configuración de la CLI de Supabase (sin secretos)                             |
| `supabase/tests/validate.mjs`   | Prueba local de todo lo anterior con PostgreSQL en memoria                     |
| `powersync/sync-config.yaml`    | Qué datos recibe cada usuario en el móvil (Sync Streams)                       |
| `scripts/check-backend.mjs`     | Comprueba, sin escribir nada, que el backend de `.env` responde                |
| `scripts/create-demo-users.mjs` | Crea los usuarios demo (opcional; también se puede desde el panel)             |

> **Por qué hace falta**: las direcciones del backend original
> (`…supabase.co` y `…powersync.journeyapps.com`) ya no existen en DNS. Con ellas la app
> solo funciona en modo demo.

**Tiempo estimado**: 45–60 minutos. **Coste**: 0 € con los planes gratuitos (ver límites
en el paso 1 y el paso 5). Hace falta crear **dos cuentas** (Supabase y PowerSync).

---

## 0. Antes de empezar: prueba local (sin cuentas)

Desde la carpeta del proyecto:

```bash
npm run backend:validate
```

Ejecuta todas las migraciones y el seed en un PostgreSQL real en memoria (PGlite) y
comprueba con más de 100 aserciones que los permisos son correctos (cada técnico ve y
modifica solo lo suyo, la oficina lee todo, un anónimo no lee nada, el seed se puede
repetir…). La primera vez descarga PGlite (≈ 10 MB) en una carpeta temporal del sistema,
no en el proyecto. Debe terminar con `0 fallidas`.

---

## 1. Crear el proyecto Supabase (requiere cuenta, gratis)

1. Entra en <https://supabase.com/dashboard> y crea una cuenta (GitHub o correo).
2. **New project**:
   - **Name**: `teins` (o `teins-staging` para pruebas).
   - **Database password**: pulsa _Generate a password_ y guárdala en un gestor de
     contraseñas. No la necesita la app, pero sí tú para administrar la base.
   - **Region**: para técnicos en **Colombia / Ecuador** se recomienda
     **East US (North Virginia)**: suele dar la menor latencia desde la región andina
     (las rutas pasan por Miami). La alternativa es **South America (São Paulo)**.
     Usa la misma región en PowerSync (paso 5). La región no se puede cambiar después.
   - **Plan**: _Free_.
3. Espera 1–2 minutos a que el proyecto esté listo.

**Límites del plan gratuito de Supabase** (supabase.com/pricing, consultado en noviembre de
2026): base de datos de 500 MB, 1 GB de archivos (Storage), 50 000 usuarios activos al
mes, 5 GB de transferencia, máximo 2 proyectos gratuitos activos y **el proyecto se pausa
tras 1 semana sin actividad** (se reactiva desde el panel). Para producción conviene el
plan Pro (desde 25 USD/mes), que no se pausa y tiene copias de seguridad diarias.

---

## 2. Aplicar las migraciones

### Opción A — Editor SQL del panel (recomendada si no usas la CLI)

En el panel: **SQL Editor → New query**. Para **cada archivo**, en este orden exacto:

1. `supabase/migrations/20260101000100_esquema_inicial.sql`
2. `supabase/migrations/20260101000200_politicas_rls.sql`
3. `supabase/migrations/20260101000300_storage_fotos.sql`
4. `supabase/migrations/20260101000400_powersync.sql`

abre el archivo en un editor de texto, copia **todo** su contenido, pégalo en el editor
SQL y pulsa **Run**. Debe responder _Success. No rows returned_. Si el panel avisa de que
la consulta contiene operaciones destructivas (por los `DROP POLICY IF EXISTS`), confirma:
solo borra políticas para volver a crearlas.

Las migraciones son **idempotentes**: si alguna falla a mitad, corrige el problema y
vuelve a ejecutar el mismo archivo.

### Opción B — Supabase CLI

```bash
npx supabase login                       # abre el navegador
npx supabase link --project-ref <ref>    # <ref> = la parte de la URL antes de .supabase.co
npx supabase db push                     # aplica supabase/migrations en orden
```

`db push` no ejecuta el seed en el proyecto remoto: hazlo con el editor SQL (paso 4).

### 2.1. Contraseña del rol de PowerSync (obligatorio)

La migración 4 crea el rol `powersync_role` (con `REPLICATION`, `BYPASSRLS` y solo
`SELECT` sobre las 9 tablas), **sin contraseña**, porque el repositorio no debe contener
secretos. Genera una contraseña larga y aleatoria (p. ej. 32 caracteres del gestor de
contraseñas, solo letras y números para evitar problemas en la URL de conexión) y, en el
editor SQL, ejecuta **una vez**:

```sql
ALTER ROLE powersync_role WITH PASSWORD 'pega-aquí-la-contraseña';
```

No guardes esta consulta en el panel (_Save_), ni la contraseña en el repositorio.

---

## 3. Comprobar el resultado en el panel

- **Table Editor**: 10 tablas (`profiles`, `visits`, … `audit_logs`), todas con el
  candado de RLS activado.
- **Storage**: bucket `visit-photos`, privado.
- **Database → Publications**: `powersync` con 9 tablas.

---

## 4. Usuarios demo y datos demo

### 4.1. Crear los usuarios

El rol de cada usuario se lee de **app_metadata** (solo lo puede escribir un
administrador). Por eso el rol `office` se asigna con el seed o con el script.

**Desde el panel**: _Authentication → Users → Add user → Create new user_:

- `tecnico@teins.com` — contraseña a tu elección — marca **Auto Confirm User**.
- `oficina@teins.com` — igual.

Se crean como técnicos; el seed (4.2) pone a `oficina@teins.com` el rol `office`.

**Con el script** (alternativa): necesita la clave **secreta** del proyecto
(_Project Settings → API Keys_: la `service_role` heredada o una `sb_secret_…`). Esa clave
salta todas las reglas de seguridad: solo en una variable de entorno de tu terminal, nunca
en `.env`, EAS ni el repositorio.

```powershell
# PowerShell
$env:SUPABASE_URL = "https://<ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<clave secreta>"
$env:DEMO_PASSWORD = "<contraseña para los dos usuarios>"
node scripts/create-demo-users.mjs
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:DEMO_PASSWORD
```

### 4.2. Cargar los datos demo

En el editor SQL, pega y ejecuta `supabase/seed.sql`. Inserta tipos de visita, las 5
plantillas (idénticas a `src/assets/form_templates.json`), 14 materiales y, **si existen
los usuarios demo**, sus perfiles y 3 visitas del técnico. Si los usuarios todavía no
existen no falla: créalos y ejecútalo otra vez. Se puede repetir sin duplicar nada y sin
pisar el avance de las visitas.

> En producción no ejecutes la parte de usuarios/visitas demo: crea los técnicos reales
> (_Add user_) y carga el catálogo real.

---

## 5. Crear la instancia PowerSync (requiere cuenta, gratis)

1. Crea una cuenta en <https://dashboard.powersync.com> y un proyecto.
2. Crea una **instancia** en la región más cercana a la de Supabase (EE. UU. si elegiste
   North Virginia).
3. **Database Connections → Connect to Source Database**:
   - En Supabase pulsa **Connect** (arriba) y copia la cadena de **conexión directa**
     (_Direct connection_, puerto **5432**, host `db.<ref>.supabase.co`). No uses el pooler.
   - Pégala en el campo **URI** de PowerSync y cambia usuario y contraseña por
     `powersync_role` y la contraseña del paso 2.1.
   - **SSL Mode**: `verify-full` (PowerSync ya confía en el certificado de Supabase).
   - _Test connection_ → _Save_.
4. **Client Auth**: marca **Use Supabase Auth**.
   - Proyecto nuevo de Supabase (claves de firma JWT asimétricas, lo normal hoy): deja
     **vacío** el campo _Supabase JWT Secret_. PowerSync detecta solo el JWKS
     (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`) a partir de la cadena
     de conexión, con audiencia `authenticated`.
   - Solo si el proyecto aún usa el secreto JWT heredado (HS256): pega ese secreto
     (_Project Settings → JWT Keys → Legacy JWT secret_).
   - _Save and deploy_.
5. **Sync Streams** (configuración de sincronización): borra el ejemplo, pega el contenido
   completo de `powersync/sync-config.yaml`, pulsa **Validate** y luego **Deploy**.
6. Copia la **URL de la instancia** (botón _Connect_ / _Instance URL_, del estilo
   `https://xxxxxxxx.powersync.journeyapps.com`).

La configuración sincroniza, para cada usuario: su perfil, sus visitas, las respuestas,
materiales, fotos y anotaciones de esas visitas, y los tipos de visita, plantillas y
materiales activos. Los JSONB (`responses`, `elements`, `sections_json`) llegan como
texto JSON y los booleanos como 1/0, que es lo que espera la app.

Con la CLI de PowerSync, el mismo archivo se usa como `powersync/sync-config.yaml`
(junto a un `service.yaml` que genera `powersync init cloud` y que contiene la conexión
— no lo subas con contraseñas).

**Límites del plan gratuito de PowerSync** (powersync.com/pricing, noviembre de 2026):
2 GB sincronizados al mes, 500 MB alojados, 50 clientes conectados a la vez, y la
instancia se **desactiva tras un periodo sin actividad** (la página indica 1 semana).
El plan Pro cuesta desde 49 USD/mes.

---

## 6. Variables de la app

| Variable            | Dónde se obtiene                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`      | Supabase → _Project Settings → Data API_ (o botón _Connect_): `https://<ref>.supabase.co`                                                                     |
| `SUPABASE_ANON_KEY` | Supabase → _Project Settings → API Keys_: la **publicable** (`sb_publishable_…`, recomendada) o la `anon` heredada. **Nunca** `service_role` ni `sb_secret_…` |
| `POWERSYNC_URL`     | URL de la instancia (paso 5.6)                                                                                                                                |

La variable se sigue llamando `SUPABASE_ANON_KEY` aunque contenga la clave publicable:
`@supabase/supabase-js` acepta cualquiera de las dos en `createClient` y la app no
necesita cambios. Supabase anuncia la retirada de las claves heredadas (`anon`,
`service_role`) a finales de 2026, así que conviene usar la publicable desde ya.

1. Local: copia `.env.example` a `.env` y rellena las tres.
2. EAS (builds en la nube): ver [COMPILACION.md, sección 3.3](COMPILACION.md); por ejemplo
   `npx eas-cli@latest env:set --environment preview --name SUPABASE_ANON_KEY --value "<clave>" --visibility sensitive`.

---

## 7. Comprobar

```bash
npm run backend:check
```

Lee `.env` y comprueba (sin escribir nada): que los dominios resuelven, la salud de Auth,
que las 9 tablas existen por la API REST (con la clave pública es normal ver `401`: la
tabla existe y está protegida; `404` significa que faltan migraciones), el bucket (si es
consultable) y que PowerSync responde. Nunca imprime la clave. Termina con
`Todo correcto.` o con la lista de problemas.

Después, en un dispositivo: inicia sesión con `tecnico@teins.com`, comprueba que aparecen
las 3 visitas demo, rellena un formulario, añade un material y una foto, y verifica en el
panel de Supabase (_Table Editor_ y _Storage_) que llegan los datos.

---

## 8. Problemas frecuentes

| Síntoma                                                                | Causa probable y solución                                                                                                                           |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend:check`: «NO resuelve (DNS)»                                   | URL mal copiada, o proyecto pausado/eliminado. Revisa `.env`; en Supabase, _Restore project_ si está pausado                                        |
| Tablas con `404` o «no existe»                                         | Falta alguna migración, o se aplicaron en otro proyecto. Repite el paso 2                                                                           |
| Auth `401`                                                             | Clave incorrecta o de otro proyecto                                                                                                                 |
| Login correcto pero sin visitas                                        | El usuario no tiene visitas: ejecuta `seed.sql` **después** de crear los usuarios. O PowerSync no tiene las Sync Streams desplegadas                |
| PowerSync: `PSYNC_S2101` (no encuentra la clave)                       | Proyecto Supabase a medio migrar a claves asimétricas, sesión antigua (cierra sesión y vuelve a entrar) o secreto heredado incorrecto               |
| PowerSync: `PSYNC_S2105` (falta `aud`)                                 | Configuraste el JWKS a mano sin la audiencia `authenticated`. Usa _Use Supabase Auth_                                                               |
| PowerSync no conecta a la base                                         | Contraseña de `powersync_role` sin poner (paso 2.1), cadena del pooler en vez de la directa, o caracteres especiales en la contraseña sin codificar |
| Una subida queda en «Incidencias de sincronización» con código `42501` | Permiso denegado por RLS: el usuario no es técnico activo o la visita no es suya                                                                    |
| Las fotos no suben (`403` en Storage)                                  | La ruta no es `visits/<id de una visita propia>/photos/…` o el usuario no es técnico activo                                                         |
| Proyecto pausado                                                       | Plan gratuito tras 1 semana sin uso: _Restore_ en el panel                                                                                          |

---

## 9. Qué se corrigió respecto a las migraciones originales

Las migraciones originales (`ARCHIVOS_REFERENCIA/migrations`) se revisaron y se probaron
en PGlite. Errores reales encontrados:

1. **`visits_update_own_technician` rompía cualquier actualización** de un técnico con 2 o
   más visitas: la subconsulta `(SELECT technician_id FROM visits WHERE id = visits.id)`
   compara la tabla consigo misma y devuelve varias filas
   (_more than one row returned by a subquery_, comprobado en PGlite). Se elimina:
   `WITH CHECK (technician_id = auth.uid())` ya impide reasignar la visita.
2. **No eran re-ejecutables**: `CREATE TYPE`, `CREATE TABLE`, `CREATE TRIGGER` y
   `CREATE POLICY` fallaban la segunda vez. Ahora son idempotentes.
3. **Seed**: fallaba si no existían los usuarios (clave foránea a `auth.users`), usaba
   UUIDs de usuarios del proyecto antiguo, duplicaba los tipos de visita en cada ejecución
   (`gen_random_uuid()` + `ON CONFLICT DO NOTHING` nunca choca) y le faltaban las
   plantillas `general` y `ups`. Ahora busca los usuarios por correo, usa UUIDs fijos y las
   5 plantillas salen de `src/assets/form_templates.json` (las 3 originales del seed eran
   versiones antiguas: les faltaban campos y opciones que sí tiene la app).
4. **Escalada de privilegios en el registro**: `handle_new_user` tomaba el rol de
   `user_metadata`, que el propio usuario controla al registrarse (podía darse `admin`).
   Ahora lo toma de `app_metadata`. Además lleva `SET search_path = ''`.
5. **Funciones `SECURITY DEFINER` sin `search_path`** y expuestas por la API como RPC en
   `public`. Ahora están en el esquema `private` (no expuesto) con `search_path` fijo.
6. **Políticas que consultaban `profiles`/`visits` con RLS** (riesgo de recursión y coste):
   sustituidas por funciones `SECURITY DEFINER` (`private.is_admin()`,
   `private.owns_visit()`…), como recomienda Supabase.
7. **Permisos de las tablas hijas**: el técnico podía borrar `form_responses` y
   `annotations` (la app nunca lo hace). Ahora puede SELECT/INSERT/UPDATE (el upsert de la
   app) en las filas de sus visitas, y DELETE solo en `visit_materials` y `photos`, que es
   lo que la app borra. Nunca borra visitas ni toca catálogo/plantillas.
8. **Storage**: la política de UPDATE no tenía `WITH CHECK` (se podía mover un objeto a la
   carpeta de otra visita) y la comprobación de ruta recorría todas las visitas. Ahora usa
   `storage.foldername()` y exige exactamente `visits/<visita propia>/photos/…`.
9. **PowerSync**: la publicación se creaba solo si no existía (no se corregía su lista) y
   se replicaba con el usuario `postgres`. Ahora se fija la lista de 9 tablas y hay un rol
   dedicado `powersync_role` con solo `SELECT`. Las reglas pasan del formato antiguo
   (_Sync Rules_ con `token_parameters.user_id`) a _Sync Streams_ con `auth.user_id()`.
10. **Permisos de tabla explícitos**: `anon` no tiene ningún permiso; no se depende de los
    permisos por defecto del proyecto.
11. Menores: restricción única de plantillas `(visit_type, version)` (la original incluía
    `is_active`), sin extensiones innecesarias (`uuid-ossp` no se usaba;
    `gen_random_uuid()` es nativa), índice duplicado sobre `material_catalog.code`
    eliminado.

## 10. Lo que no se puede probar en local

PGlite ejecuta PostgreSQL real, pero no Supabase: los esquemas `auth` y `storage` se
simulan con lo mínimo (tabla de usuarios, `auth.uid()` leyendo el JWT de la petición,
tablas de Storage con RLS y `storage.foldername`). No se prueban la API REST real, el
servicio de Storage (tamaño máximo y tipos MIME los aplica ese servicio), la replicación
lógica ni la conexión de PowerSync. Eso se comprueba con `npm run backend:check` y en un
dispositivo (paso 7).

## Referencias

- Supabase + PowerSync: <https://docs.powersync.com/integrations/supabase/guide>
- Sync Streams: <https://docs.powersync.com/sync/streams/overview> y
  <https://docs.powersync.com/sync/streams/queries>
- Tipos sincronizados: <https://docs.powersync.com/sync/types>
- Autenticación con Supabase en PowerSync: <https://docs.powersync.com/configuration/auth/supabase-auth>
- Preparar Postgres para PowerSync: <https://docs.powersync.com/configuration/source-db/setup>
- Claves de API de Supabase: <https://supabase.com/docs/guides/api/api-keys>
- Control de acceso en Storage: <https://supabase.com/docs/guides/storage/security/access-control>
