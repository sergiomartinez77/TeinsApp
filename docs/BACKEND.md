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
comprueba con más de 150 aserciones que los permisos son correctos (cada técnico ve y
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
5. `supabase/migrations/20261118000100_fotos_ubicacion.sql`
6. `supabase/migrations/20261118000200_materiales_personalizados.sql`
7. `supabase/migrations/20261118000300_varios_formularios.sql`
8. `supabase/migrations/20261122000100_planos_y_figuras.sql`

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
`SELECT` sobre las 9 tablas; la migración 8 le añade `annotation_figures` y la 9,
`material_stock` y `material_stock_movements`), **sin contraseña**, porque el repositorio no debe contener
secretos. Genera una contraseña larga y aleatoria (p. ej. 32 caracteres del gestor de
contraseñas, solo letras y números para evitar problemas en la URL de conexión) y, en el
editor SQL, ejecuta **una vez**:

```sql
ALTER ROLE powersync_role WITH PASSWORD 'pega-aquí-la-contraseña';
```

No guardes esta consulta en el panel (_Save_), ni la contraseña en el repositorio.

---

### 2.2. Proyecto que ya existe: aplicar las migraciones de noviembre de 2026 (obligatorio)

Si el backend **ya estaba creado** (con las migraciones 1–4), hay que aplicar las tres
migraciones nuevas, **en este orden**, con el editor SQL (Opción A) o `npx supabase db push`
(Opción B). Son idempotentes y **conservan todos los datos**:

| Migración                                      | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                 | Datos existentes                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261118000100_fotos_ubicacion.sql`           | `photos`: columnas opcionales `latitude`, `longitude`, `location_accuracy` (metros) y `taken_at` (hora impresa en la foto). Restricciones: coordenadas en rango y siempre juntas; precisión ≥ 0                                                                                                                                                                                                                          | No cambia ninguna fila: las fotos anteriores quedan con esas columnas en NULL (sin marca)                                                                                                                                                                                   |
| `20261118000200_materiales_personalizados.sql` | `visit_materials.material_id` admite NULL; columna `is_custom BOOLEAN NOT NULL DEFAULT FALSE`; `chk_visit_material_source` (del catálogo con `material_id`, o personalizado sin él); `chk_visit_material_custom_text` (nombre 1–120 y unidad 1–20); índice único `uq_visit_material_custom` (mismo nombre y unidad en la visita, sin distinguir mayúsculas). El código guardado en los personalizados es `PERSONALIZADO` | Todas las filas quedan con `is_custom = FALSE` (son del catálogo). `updated_at` no cambia                                                                                                                                                                                   |
| `20261118000300_varios_formularios.sql`        | `form_responses`: columna `template_key` (UUID de la plantilla en texto o id de la plantilla de respaldo de la app); trigger que la calcula si una escritura llega sin ella (versiones anteriores de la app); se quita `UNIQUE (visit_id)` y se añade `UNIQUE (visit_id, template_key)`: varios formularios por visita, uno por plantilla                                                                                | Se rellena `template_key` = `template_id` o `responses->>'__template_key'`, **sin cambiar `updated_at`** (trigger de fecha desactivado durante el relleno). Una respuesta sin ninguno de los dos queda con NULL y la app la sigue mostrando como antes (por tipo de visita) |

Las políticas RLS no cambian: las de `visit_materials` y `form_responses` dependen de
`visit_id`, así que el técnico puede crear, editar y quitar materiales personalizados y
crear varios formularios **solo en sus visitas** (comprobado en `npm run backend:validate`,
secciones 13–15 y 17, que además aplica las migraciones sobre un proyecto con datos).

**PowerSync**: vuelve a pegar `powersync/sync-config.yaml` en _Sync Streams_ y pulsa
**Deploy**: la consulta de `visit_materials` enumera columnas y ahora incluye `is_custom`.
`photos` y `form_responses` usan `SELECT *` y reciben las columnas nuevas solas. La
publicación `powersync` no hay que tocarla.

### 2.3. Proyecto que ya existe: planos y figuras (migración 8, obligatorio)

Aplica `supabase/migrations/20261122000100_planos_y_figuras.sql` (Opción A u Opción B).
Es idempotente y **conserva los planos existentes**:

- `annotations`: se quita `UNIQUE (visit_id)` (**varios planos por visita**); columna
  `format_version INTEGER NOT NULL DEFAULT 1` con CHECK 1 o 2 (1 = puntos normalizados
  0–1 respecto a `canvas_width`/`canvas_height`, el formato antiguo; 2 = coordenadas en
  centímetros, sin límites, grosores en píxeles de pantalla). Los planos existentes quedan
  en 1 y no cambian. Política nueva `annotations_delete_own_technician`: el técnico puede
  **borrar** los planos de sus visitas (no los de otros).
- Tabla nueva `annotation_figures` (**biblioteca de figuras** de cada técnico, para
  reutilizarlas en otras visitas): `technician_id`, `name` (1–60 caracteres), `elements`
  (JSONB), `width`, `height`, `sync_status`. RLS: cada técnico ve, crea, modifica y borra
  **solo las suyas** (oficina y admin no las ven; anónimo, sin acceso).
- PowerSync: la tabla se añade a la publicación `powersync` y `powersync_role` recibe
  `SELECT` sobre ella. Si usas un usuario `powersync_<id>` propio (paso 5), dale también
  `GRANT SELECT ON public.annotation_figures TO "powersync_<id>";`.

**PowerSync**: vuelve a pegar `powersync/sync-config.yaml` en _Sync Streams_ y pulsa
**Deploy**: hay un stream nuevo, `mis_figuras`
(`SELECT * FROM annotation_figures WHERE technician_id = auth.user_id()`).
`annotations` usa `SELECT *` y recibe `format_version` sola.

Comprobado en `npm run backend:validate` (secciones 16 y 18).

**Orden de despliegue**: aplica las migraciones y despliega la configuración de PowerSync
**antes** de instalar la versión nueva de la app. Si la app nueva sube datos a un servidor
sin migrar, Supabase responde que la columna no existe; la subida se reintenta (no se
pierde nada) pero no avanza hasta que se migre.

### 2.4. Inventario de bodega (migración 9, obligatorio)

Aplica `supabase/migrations/20261122000200_inventario.sql` (Opción A u Opción B). Es
idempotente y **no cambia ninguna fila existente** de visitas ni materiales:

- `material_catalog.min_stock NUMERIC(12,3)` (NULL = sin mínimo, CHECK ≥ 0): por debajo de
  ese valor la app muestra el material en **«Qué comprar»**. Solo el **admin** lo cambia
  (política `material_catalog_manage_admin` de la migración 2; desde la app o desde el
  _Table Editor_). Oficina y técnicos lo leen.
- Tabla nueva `material_stock_movements`: compras (`kind = 'purchase'`, cantidad > 0) y
  ajustes (`kind = 'adjustment'`, cantidad ≠ 0, puede ser negativa) con `note` (≤ 500),
  `created_by` (= `auth.uid()`) y `sync_status` (para que la app sepa qué movimientos aún no
  subió). RLS: la **lee** cualquier usuario activo; **crear, modificar y borrar**, solo admin
  u oficina (al crear, `created_by` tiene que ser el propio usuario). Un técnico que
  intentara subir un movimiento recibe un rechazo (42501) que queda en _Cambios rechazados_.
- Tabla nueva `material_stock`: existencias por material del catálogo (`purchased`,
  `adjusted`, `used`, `on_hand = purchased + adjusted − used`; puede ser negativo si se
  registró más uso que entradas). **Solo la escriben triggers** (funciones
  `SECURITY DEFINER` del esquema `private`, sin permiso de ejecución para los clientes):
  - compras y ajustes: alta, cambio (cantidad, tipo o material) y borrado;
  - `visit_materials` del catálogo (`is_custom = false`): alta, cambio de cantidad, de
    material o paso a/desde personalizado, y borrado (también el borrado en cascada al
    borrar una visita). Los **personalizados no cuentan**: no son de bodega;
  - material nuevo en el catálogo: nace con existencias en cero.

  Nadie tiene política de escritura (ni el admin). `on_hand` es una columna normal y no
  `GENERATED` porque la replicación lógica de PostgreSQL < 18, la que usa PowerSync, no
  publica columnas generadas.

- **Relleno**: al final la migración recalcula una fila por material del catálogo desde los
  datos existentes (`used` = suma de los `visit_materials` del catálogo ya registrados;
  compras y ajustes en 0). Las existencias iniciales quedarán **negativas** en los
  materiales ya usados: registra un **ajuste** con el conteo físico de la bodega para
  partir del valor real. Re-aplicar la migración vuelve a recalcular (corrige cualquier
  descuadre) y solo toca las filas que no cuadran.
- PowerSync: las dos tablas se añaden a la publicación `powersync` y reciben `SELECT` todos
  los roles cuyo nombre empieza por `powersync` (`powersync_role` y, si existe, el usuario
  `powersync_<id>` del paso 5). Si creas el usuario de PowerSync **después** de aplicar esta
  migración, dale también
  `GRANT SELECT ON public.material_stock, public.material_stock_movements TO "powersync_<id>";`
  (o vuelve a ejecutar la migración).

**Orden de despliegue** (en este orden):

1. Aplica la migración `20261122000200_inventario.sql`.
2. Vuelve a pegar `powersync/sync-config.yaml` en _Sync Streams_ y pulsa **Validate** y
   **Deploy**. El stream `catalogos` ahora enumera las columnas de `material_catalog` (por
   el `CAST(min_stock AS real)`; una columna nueva del catálogo hay que añadirla ahí) e
   incluye `material_stock` (entregada como `material_id AS id`, porque PowerSync necesita
   una columna `id`) y `material_stock_movements` (todos los movimientos).
3. Instala la versión nueva de la app. Con la app anterior no pasa nada: ignora las tablas
   nuevas, y el uso de materiales que registre sigue descontándose por los triggers.

**Limitaciones conocidas**:

- Las existencias que muestra la app son las que calculó el servidor en la última
  sincronización. Una compra, un ajuste o un material usado en una visita registrados en el
  dispositivo **no cambian el número hasta que el servidor los recibe**; mientras tanto la
  app marca el material como «Pendiente de sincronizar» (no inventa un valor provisional).
- El **consumo por rango de fechas** (`getConsumption` en
  `src/features/inventory/services/inventory.service.ts`) suma los `visit_materials` de las
  visitas **que hay en el dispositivo**: el técnico, las suyas (`mis_visitas`); admin y
  oficina, todas (stream `visitas_de_oficina`, ver 2.5). Las existencias
  (`material_stock.used`) cuentan siempre las visitas de todos los técnicos, porque las
  calcula el servidor.
- **Falta conteo inicial**: un material con existencias pero sin ninguna compra ni ajuste
  (`purchased = 0` y `adjusted = 0`) no muestra su `on_hand` (sería solo el uso en
  negativo, p. ej. «−63 metro»): la app muestra «Falta conteo inicial», lo usado en visitas
  y, a admin/oficina, «Registra un ajuste con lo que hay en bodega». No entra en «Qué
  comprar» (va en el grupo «Sin conteo inicial»). Con cualquier movimiento ya se muestra el
  número; si es negativo, «Stock negativo: revisa el conteo». La misma regla aplican el
  asistente básico y la función `assistant` (`sin_conteo_inicial`).
- Un cambio de `min_stock` hecho por alguien que ya no es admin no da error: la RLS lo
  ignora (0 filas) y el valor vuelve al del servidor en la siguiente sincronización.

Comprobado en `npm run backend:validate` (sección 19: RLS, cuentas de los triggers,
personalizados, borrado en cascada, `min_stock`; sección 18: relleno con datos existentes).

### 2.5. Administración y oficina ven todas las visitas en el teléfono (obligatorio redesplegar Sync Streams)

`powersync/sync-config.yaml` tiene un stream nuevo, `visitas_de_oficina`, que entrega a los
usuarios con perfil **activo** `admin` u `office` **todas** las visitas, sus filas hijas
(`form_responses`, `visit_materials` con la misma lista de columnas y el
`CAST(quantity AS real)`, `photos`, `annotations`) y los perfiles (para mostrar el nombre del
técnico de cada visita). Los técnicos no cambian: siguen recibiendo solo las suyas.

```yaml
visitas_de_oficina:
  auto_subscribe: true
  with:
    usuario_de_oficina: |
      SELECT id FROM profiles
      WHERE id = auth.user_id() AND is_active = true
        AND (role = 'admin' OR role = 'office')
  queries:
    - SELECT * FROM visits WHERE auth.user_id() IN usuario_de_oficina
    - ...
```

La condición no depende de la fila: es un único bucket global que PowerSync solo entrega a
quien cumple la subconsulta sobre `profiles` (sintaxis documentada en
https://docs.powersync.com/sync/streams/queries — _Using Subqueries_ — y
https://docs.powersync.com/sync/streams/ctes; es el equivalente de la «parameter query sin
columnas de salida» de las antiguas Sync Rules). Si cambian el rol o `is_active` del
perfil, PowerSync lo reevalúa solo. Una visita propia del admin llega por dos streams: se
guarda una sola fila (mismo id, mismas columnas).

**Despliegue**: no hay migración. Vuelve a pegar `powersync/sync-config.yaml` en _Sync
Streams_ → **Validate** → **Deploy**, e instala la versión nueva de la app. Si el panel no
acepta la sintaxis (versión antigua del servicio), avisa antes de cambiarla.

**Permisos (RLS, sin cambios)**: admin y oficina pueden LEER todas las visitas y sus filas
hijas (`*_select_all_admin_office`), pero solo el técnico de la visita puede escribir
formularios, materiales, fotos y planos (`private.owns_visit` exige rol `technician`). Por
eso la app muestra las visitas de otros técnicos como **solo lectura** («Visita de
<técnico>»): sin iniciar/finalizar ni editar; sí se consulta todo y se genera su PDF.
Nota: por la misma regla, las filas hijas de visitas creadas por un admin para sí mismo no
se pueden escribir en el servidor (comportamiento anterior, no cambia aquí).

**Volumen de datos**: un teléfono de admin/oficina descarga todas las visitas y todas sus
respuestas, materiales, planos y filas de fotos (las imágenes no: se piden con URL firmada
al verlas). Con cientos de visitas al mes la base local crece en proporción (orden de pocos
MB por cada mil visitas sin contar imágenes) y la primera sincronización tarda más. Si
llega a ser un problema, se puede limitar por fecha (p. ej. visitas de los últimos 90 días)
en ese stream. El informe PDF de una visita ajena no incluye sus fotos si los archivos no
están en el teléfono (aparece el aviso de foto no disponible).

## 3. Comprobar el resultado en el panel

- **Table Editor**: 13 tablas (`profiles`, `visits`, … `material_stock`,
  `material_stock_movements`, `audit_logs`), todas con el candado de RLS activado.
- **Storage**: bucket `visit-photos`, privado.
- **Database → Publications**: `powersync` con 12 tablas (todas menos `audit_logs`).

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

### 4.3. Usuarios nuevos y su perfil

La app **no tiene pantalla de registro**: los usuarios los crea un administrador. Para
dar de alta a alguien (un técnico real o una persona que va a probar la app):

1. _Authentication → Users → Add user → Create new user_, con su correo, una
   contraseña y **Auto Confirm User** marcado.
2. El **perfil se crea solo**: un trigger de la base inserta la fila en `profiles` con
   rol `technician`. No hay que hacer nada más para que pueda entrar y trabajar.
3. Opcional, en el editor SQL, nombre visible u otro rol:

   ```sql
   UPDATE public.profiles
   SET full_name = 'Nombre Apellido', role = 'technician'  -- o 'office' / 'admin'
   WHERE email = 'correo@ejemplo.com';
   ```

Un técnico nuevo empieza **sin visitas**: puede crearlas desde la app con "Nueva
visita". Para darle las 3 visitas de ejemplo, ejecuta `supabase/seed.sql` (solo las
asigna a `tecnico@teins.com`).

### 4.4. Desactivar el registro público (importante)

Supabase permite por defecto que **cualquiera con la URL y la clave publicable** cree una
cuenta llamando directamente a la API, aunque la app no tenga pantalla de registro. Esa
cuenta recibiría el rol `technician`. Desactívalo:

_Authentication → Sign In / Providers → **Allow new users to sign up**: desactivado._

Con eso, solo pueden existir los usuarios que crees desde el panel (o con el script).
(`supabase/config.toml` ya lo tiene desactivado, pero ese archivo solo afecta al
Supabase local, no al proyecto en la nube.)

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

> **Si PowerSync crea su propio usuario de base de datos.** El asistente de conexión con
> Supabase puede crear un usuario propio (`powersync_<id>`) en lugar de usar
> `powersync_role`. Ese usuario trae permiso de replicación pero **no puede leer las
> tablas**, así que PowerSync no llega a sincronizar (en Supabase no aparece ninguna
> ranura de replicación). Dale permiso de lectura en el editor SQL, con el nombre que
> muestre el campo _Username_ de PowerSync:
>
> ```sql
> GRANT USAGE ON SCHEMA public TO "powersync_<id>";
> GRANT SELECT ON public.profiles, public.visit_types, public.form_templates,
>   public.visits, public.form_responses, public.material_catalog,
>   public.visit_materials, public.photos, public.annotations,
>   public.annotation_figures, public.material_stock,
>   public.material_stock_movements TO "powersync_<id>";
> ```
>
> Después vuelve a pulsar **Deploy** en Sync Streams. Para comprobar que sincroniza:
> `SELECT slot_name, active FROM pg_replication_slots;` debe devolver una fila
> `powersync_…` con `active = true`.

La configuración sincroniza, para cada usuario: su perfil, sus visitas, las respuestas,
materiales, fotos y planos (anotaciones) de esas visitas, sus figuras guardadas
(`annotation_figures`), los tipos de visita, plantillas y
materiales activos, y el inventario de la bodega (`material_stock` y
`material_stock_movements`, iguales para todos). Administración y oficina reciben además
todas las visitas con sus filas hijas y los perfiles (stream `visitas_de_oficina`, ver
2.5). Los JSONB (`responses`, `elements`, `sections_json`) llegan como
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

## 7.1. Probar la app desde otro equipo

Quien clone el repositorio de GitHub **no recibe el `.env`** (está en `.gitignore`), así
que su copia no sabe a qué backend conectarse. Tiene tres opciones:

| Quiere…                                      | Necesita                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Ver la app sin cuenta                        | Nada del backend: el **modo demo** funciona sin servidor ni conexión                                               |
| Entrar con un usuario real en **tu** backend | Que le pases `SUPABASE_URL`, la clave publicable y `POWERSYNC_URL` para su `.env`, y que le crees un usuario (4.3) |
| Su propio backend                            | Seguir esta guía desde el paso 1 con sus cuentas                                                                   |

La URL y la clave **publicable** (`sb_publishable_…`) se pueden compartir: van dentro de
la app de todas formas y la seguridad la ponen las reglas de la base. **Nunca** compartas
la clave secreta (`service_role` / `sb_secret_…`) ni la contraseña de `powersync_role`.

En los tres casos necesita además compilar la app (no funciona en Expo Go): Android
Studio en su equipo o EAS Build. Ver [COMPILACION.md](COMPILACION.md).

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

## 11. Asistente (chatbot)

La pantalla **Asistente** (Inicio → «Asistente») responde preguntas sobre existencias, qué
comprar, consumo de materiales, visitas, el PDF de una visita y cómo usar la app. Tiene dos
motores detrás de la misma pantalla; la app elige sola cuál usa:

| Motor                    | Dónde corre                                   | Costo               | Cuándo se usa                                                         |
| ------------------------ | --------------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| **Asistente básico**     | En el teléfono, sin IA (reglas en español)    | Gratis, siempre     | Sin conexión, en modo demo, si la función no está activada o si falla |
| **Asistente con Claude** | Función Edge `assistant` de Supabase + Claude | Por uso (ver abajo) | Con conexión y la función activada (`ANTHROPIC_API_KEY` configurada)  |

Los dos responden solo con datos reales: el básico con la base local del teléfono (APIs de
inventario e informes) y la guía de uso (`src/features/assistant/knowledge/guide.ts`); el de
Claude con herramientas que consultan Postgres **con el token del usuario**, así que la RLS
decide qué ve cada uno (el técnico, sus visitas; oficina y administración, todas). Ninguno
escribe datos. El PDF siempre se genera en el teléfono: la función solo devuelve la acción
«Compartir PDF» y la app la ejecuta con la API de informes (por eso un PDF solo se puede
generar en el teléfono del técnico de la visita).

Mientras no actives Claude, la app funciona igual con el asistente básico: la función responde
`503 not_configured`, la app lo recuerda durante la sesión y no lo vuelve a intentar. Si la
función no está desplegada (404), pasa lo mismo.

### 11.1. Desplegar la función

El código está en `supabase/functions/assistant/` (`index.ts` conecta Deno con la lógica de
`handler.ts`, `tools.ts`, `loop.ts`, `prompt.ts`; `guide.json` es la guía generada). Con la
CLI de Supabase y la sesión iniciada (`npx supabase login`):

```bash
npx supabase functions deploy assistant --project-ref <REF_DEL_PROYECTO>
```

- Deja **activa** la verificación del JWT (es el valor por defecto; no uses `--no-verify-jwt`):
  solo usuarios con sesión pueden llamarla.
- La función usa `npm:@anthropic-ai/sdk` y `npm:@supabase/supabase-js@2` (Deno los descarga al
  desplegar) y las variables `SUPABASE_URL` / `SUPABASE_ANON_KEY` que Supabase ya inyecta.
- Si cambias la guía (`guide.ts`), ejecuta `npm run assistant:guide` y vuelve a desplegar. Un
  test falla si `guide.json` quedó desactualizado.
- Para revisar tipos de `index.ts` con Deno (opcional): `deno check supabase/functions/assistant/index.ts`.
  El `tsc` de la app excluye ese archivo; el resto de la función sí lo compila y lo prueba jest.

### 11.2. Activar Claude (cuando se venda la app)

Supabase Dashboard → **Edge Functions → Secrets** (o `npx supabase secrets set …`):

| Secreto             | Valor                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Clave de la consola de Anthropic (<https://console.anthropic.com>)        |
| `ASSISTANT_MODEL`   | `claude-haiku-5-5` (por defecto), `claude-sonnet-5-5` o `claude-opus-5-5` |
| `ASSISTANT_EFFORT`  | Opcional: `low` (por defecto, chat) o `medium`                            |

No hace falta otra versión de la app: al haber clave, la siguiente sesión empieza a usar Claude
(en la pantalla aparece «Asistente con IA (Claude)» bajo cada respuesta). Para volver al
básico, borra `ANTHROPIC_API_KEY`. Cambiar de modelo es solo cambiar `ASSISTANT_MODEL`.

Detalles de la integración: bucle de herramientas de hasta 6 pasos; caché de prompts en las
instrucciones y herramientas (se cobran a precio reducido en cada pregunta); con Opus 5.5 y
Sonnet 5.5 se activa el reintento del servidor en otro modelo si un filtro de seguridad rechaza
la petición (`fallbacks: "default"`); Haiku 5.5 no tiene ese reintento y el rechazo se responde
con un mensaje honesto. Los errores de Anthropic vuelven como JSON (`rate_limited`,
`overloaded`, `ai_auth`, `ai_unavailable`) y la app responde con el básico avisando.

### 11.3. Modelo y costos

Precios de Anthropic por millón de tokens (entrada / salida), noviembre de 2026; confírmalos en
<https://www.anthropic.com/pricing> antes de presupuestar:

| Modelo                       | Entrada   | Salida    | Uso recomendado                                 |
| ---------------------------- | --------- | --------- | ----------------------------------------------- |
| `claude-haiku-5-5` (defecto) | ≈ US$0,10 | ≈ US$0,50 | Chat del día a día: rápido y muy barato         |
| `claude-opus-5-5`            | ≈ US$4    | ≈ US$20   | Preguntas más complejas; unas 40 veces más caro |

Orientación (no es una cotización): una pregunta típica usa unos pocos miles de tokens de
entrada (gran parte en caché) y algunos cientos de salida, del orden de **US$0,001 con Haiku
5.5** y **US$0,04 con Opus 5.5**. El precio de Haiku 5.5 indicado es para peticiones de hasta
100 000 tokens (las del asistente quedan muy por debajo).

- Anthropic da **créditos de prueba** al crear la cuenta, pero **no tiene un plan gratuito
  permanente**: después se paga por uso (configura un límite de gasto en la consola).
- El **asistente básico es siempre gratis** y no depende de Anthropic ni de Internet.

### 11.4. Probar la función

- `npx jest supabase/functions` prueba la lógica (herramientas, bucle, errores) con clientes
  simulados.
- Con la función desplegada y sin clave: en la app, una pregunta responde el básico sin aviso.
- Con clave: ver docs/PRUEBAS_MANUALES.md §25.

## Referencias

- Supabase + PowerSync: <https://docs.powersync.com/integrations/supabase/guide>
- Sync Streams: <https://docs.powersync.com/sync/streams/overview> y
  <https://docs.powersync.com/sync/streams/queries>
- Tipos sincronizados: <https://docs.powersync.com/sync/types>
- Autenticación con Supabase en PowerSync: <https://docs.powersync.com/configuration/auth/supabase-auth>
- Preparar Postgres para PowerSync: <https://docs.powersync.com/configuration/source-db/setup>
- Claves de API de Supabase: <https://supabase.com/docs/guides/api/api-keys>
- Control de acceso en Storage: <https://supabase.com/docs/guides/storage/security/access-control>
