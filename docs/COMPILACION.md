# Compilación y publicación

Guía paso a paso para compilar TEINS con **EAS Build** (el servicio de compilación
en la nube de Expo) o en local, pensada para alguien que no ha usado EAS nunca.

La app usa módulos nativos (PowerSync + op-sqlite, Skia, cámara, impresión a PDF...), así que **no
funciona en Expo Go**: siempre se instala un build propio (_development build_ para
programar, _preview_ para testers y _production_ para las tiendas).

> Los comandos de EAS se escriben como `npx eas-cli@latest <comando>` (es lo que
> recomienda Expo: no hace falta instalar nada globalmente). Si prefieres, instala
> la CLI una vez con `npm install -g eas-cli` y usa `eas <comando>`.
> Los scripts `npm run build:*` de `package.json` ya usan `npx eas-cli@latest`.

---

## 0. Estado del backend (leer antes de nada)

Hoy **las direcciones de Supabase y PowerSync documentadas no resuelven en DNS**:
el proyecto Supabase y la instancia PowerSync de la app original ya no existen o
han cambiado. Con esos valores la app solo funciona en **modo demo**.

Antes de un build de **staging** o **producción** hace falta un backend operativo (paso a paso en [BACKEND.md](BACKEND.md)):

1. Un proyecto **Supabase** con:
   - las migraciones de `supabase/migrations` aplicadas, en orden, y `supabase/seed.sql`;
   - la publicación de Postgres `powersync` (la que lee PowerSync);
   - el bucket de Storage `visit-photos` con sus políticas;
   - los usuarios técnicos creados (Authentication → Users) y sus perfiles.
2. Una instancia **PowerSync** conectada a esa base, con la configuración de sincronización
   `powersync/sync-config.yaml` (Sync Streams) desplegada y la autenticación de Supabase (JWT) configurada.
3. Las variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `POWERSYNC_URL` actualizadas
   en tu `.env` (local) y en los entornos de EAS (sección 3).

La configuración (`app.config.ts`) **se niega a generar** un build de `staging` o
`production` si falta alguna de las tres variables, con un mensaje como:

```
[TEINS] No se puede generar la configuración para APP_ENV=production: faltan las
variables obligatorias SUPABASE_URL. ...
```

Lo que no detecta es una dirección **incorrecta**: compruébalas antes de compilar con
`npm run backend:check` (ver [BACKEND.md](BACKEND.md)).

---

## 1. Requisitos

| Qué                                                                                              | ¿Obligatorio?                                                                            | Coste                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 22.13+ o 24.3+ (lo exigen `expo` y `react-native`; probado con 24) y `npm install` hecho | Sí                                                                                       | Gratis                                                                                                                                              |
| Cuenta de **Expo** (expo.dev)                                                                    | Sí, para EAS                                                                             | Gratis. El plan gratuito incluye un número limitado de builds al mes en la nube, con cola de espera. Los planes de pago dan más builds y prioridad. |
| Cuenta de **Google Play Console**                                                                | Solo para publicar en Google Play                                                        | Pago único de 25 USD                                                                                                                                |
| Cuenta de **Apple Developer Program**                                                            | Para **cualquier** build de iOS en un iPhone real (también internos) y para la App Store | 99 USD al año                                                                                                                                       |
| Android Studio (JDK 17 + Android SDK)                                                            | Solo para compilar Android **en local**                                                  | Gratis                                                                                                                                              |
| Mac con Xcode                                                                                    | Solo para compilar iOS **en local**                                                      | —                                                                                                                                                   |

Sin cuenta de Apple Developer solo es posible el build para el **simulador de iOS**
(perfil `development-simulator`), que únicamente se puede abrir en un Mac.

---

## 2. Perfiles de build (`eas.json`)

| Perfil                  | Para qué                                        | Android          | iOS                               | `APP_ENV`                         | Entorno de variables EAS |
| ----------------------- | ----------------------------------------------- | ---------------- | --------------------------------- | --------------------------------- | ------------------------ |
| `development`           | Programar con recarga en caliente (`npm start`) | APK instalable   | iPhone real registrado (ad hoc)   | `development`                     | `development`            |
| `development-simulator` | Igual, en el simulador de iOS (solo Mac)        | APK              | Simulador                         | `development`                     | `development`            |
| `preview`               | Repartir a testers                              | APK instalable   | Ad hoc (dispositivos registrados) | `staging`                         | `preview`                |
| `production`            | Google Play / App Store                         | AAB (app bundle) | Build de tienda                   | `production` (+ `LOG_LEVEL=info`) | `production`             |

Cada variante de ambiente se instala **junto a las demás** en el mismo dispositivo:

| `APP_ENV`     | Nombre visible  | Identificador (Android e iOS) | Esquema de deep link |
| ------------- | --------------- | ----------------------------- | -------------------- |
| `development` | TEINS (Dev)     | `com.teins.app.dev`           | `teins-dev://`       |
| `staging`     | TEINS (Staging) | `com.teins.app.staging`       | `teins-staging://`   |
| `production`  | TEINS           | `com.teins.app`               | `teins://`           |

`APP_ENV` y `LOG_LEVEL` no son secretos y van en `eas.json` (campo `env`). Las
direcciones y la clave del backend **no** se escriben en `eas.json` ni en el repositorio:
viven en los **entornos de variables de EAS** (`development`, `preview`, `production`),
que cada perfil selecciona con el campo `environment`.

---

## 3. Primera vez

### 3.1. Iniciar sesión

```bash
npx eas-cli@latest login
npx eas-cli@latest whoami     # comprueba con qué cuenta estás
```

### 3.2. Crear el proyecto en EAS

```bash
npx eas-cli@latest init
```

`eas init` crea el proyecto en expo.dev y genera su **id de proyecto** (un UUID). Como
la configuración es dinámica (`app.config.ts`), EAS no puede escribirlo solo: te pedirá
añadirlo a mano. La configuración lo lee de la variable `EAS_PROJECT_ID`
(`extra.eas.projectId`). El id **no es secreto**; tienes dos opciones:

- **Recomendada (la más simple):** sustituye en `app.config.ts`
  `env.EAS_PROJECT_ID?.trim()` por `env.EAS_PROJECT_ID?.trim() || '<tu-id>'`.
  Así lo ven igual tu PC, EAS CLI y los servidores de EAS.
- **Solo con variables:** EAS CLI **no lee `.env`** al resolver la configuración, de modo
  que tendrías que definir `EAS_PROJECT_ID` en la terminal antes de cada comando
  (`$env:EAS_PROJECT_ID="<tu-id>"` en PowerShell, `export EAS_PROJECT_ID=<tu-id>` en bash)
  **y** como variable de EAS en los tres entornos (siguiente paso).

### 3.3. Crear las variables de entorno en EAS

Se crean una vez por entorno. Comando actual (`eas env:set` crea o actualiza):

```bash
# --- development ---
npx eas-cli@latest env:set --environment development --name SUPABASE_URL      --value "https://<proyecto>.supabase.co"               --visibility plaintext
npx eas-cli@latest env:set --environment development --name POWERSYNC_URL     --value "https://<instancia>.powersync.journeyapps.com" --visibility plaintext
npx eas-cli@latest env:set --environment development --name SUPABASE_ANON_KEY --value "<clave anon>"                                  --visibility sensitive

# --- preview (builds de staging para testers) ---
npx eas-cli@latest env:set --environment preview --name SUPABASE_URL      --value "https://<proyecto-staging>.supabase.co" --visibility plaintext
npx eas-cli@latest env:set --environment preview --name POWERSYNC_URL     --value "https://<instancia-staging>.powersync.journeyapps.com" --visibility plaintext
npx eas-cli@latest env:set --environment preview --name SUPABASE_ANON_KEY --value "<clave anon de staging>" --visibility sensitive

# --- production ---
npx eas-cli@latest env:set --environment production --name SUPABASE_URL      --value "https://<proyecto>.supabase.co" --visibility plaintext
npx eas-cli@latest env:set --environment production --name POWERSYNC_URL     --value "https://<instancia>.powersync.journeyapps.com" --visibility plaintext
npx eas-cli@latest env:set --environment production --name SUPABASE_ANON_KEY --value "<clave anon>" --visibility sensitive

# Comprobar
npx eas-cli@latest env:list --environment production --include-sensitive
```

(En PowerShell escribe cada comando en una sola línea; también puedes crearlas desde
expo.dev → tu proyecto → _Environment variables_.)

**Visibilidad — por qué así:**

- Las tres variables acaban **dentro de la app** (en `extra`) y cualquiera puede extraerlas
  del APK: **son públicas por diseño**. La seguridad de los datos la dan el login de
  Supabase y las políticas RLS, no el secreto de estas claves.
- `plaintext` para las direcciones; `sensitive` para la clave `anon` (se oculta en los logs,
  pero EAS CLI puede leerla).
- **No uses `secret`** para estas tres: las variables `secret` no salen de los servidores de
  Expo y EAS CLI no puede leerlas al evaluar `app.config.ts` en tu PC antes de subir el
  build; la validación fallaría diciendo que faltan.
- **NUNCA** pongas la clave `service_role` de Supabase, ni en EAS ni en `.env`: salta todas
  las políticas RLS y da acceso total a la base. Si se filtra (y en una app móvil se filtra),
  cualquiera puede leer y borrar todos los datos. La app solo necesita la `anon`.

Para traer las variables de un entorno a un archivo local (por ejemplo, para probar la
configuración de producción): `npx eas-cli@latest env:pull --environment production`
(crea `.env.local`, que está en `.gitignore`).

### 3.4. Comprobar la configuración

```bash
npm run prebuild:check   # evalúa app.config.ts y ejecuta expo-doctor
```

---

## 4. Development build de Android

### 4.1. En la nube (EAS) — no necesita Android Studio

```bash
npm run build:dev:android
```

La primera vez EAS pregunta si genera el **keystore** (la firma de Android): responde que sí;
lo guarda EAS. Al terminar muestra un enlace y un código QR.

**Instalar:**

- **Dispositivo:** abre el enlace o el QR en el móvil y descarga el APK (Android pedirá
  permitir "instalar apps de origen desconocido" para el navegador).
- **Emulador:** descarga el `.apk` y arrástralo a la ventana del emulador, o
  `adb install ruta\al\archivo.apk`.

Después, en el PC: `npm start` y abre la app **TEINS (Dev)**; se conecta al servidor de
desarrollo (misma red Wi‑Fi, o `npx expo start --dev-client --tunnel` si la red lo impide).

### 4.2. En local con Android Studio (`npm run android`)

Requisitos en Windows:

1. **Android Studio** con: Android SDK Platform 37 (el _compileSdk_ de React Native 0.88; _targetSdk_ 36),
   Android SDK Build-Tools, Platform-Tools, Android Emulator y una imagen de sistema.
2. **JDK 17** (el que trae Android Studio sirve: `C:\Program Files\Android\Android Studio\jbr`).
3. Variables de entorno de Windows:
   - `JAVA_HOME` = carpeta del JDK 17
   - `ANDROID_HOME` = `%LOCALAPPDATA%\Android\Sdk`
   - Añadir a `Path`: `%ANDROID_HOME%\platform-tools` y `%ANDROID_HOME%\emulator`
4. Un emulador arrancado o un móvil con _depuración USB_ (`adb devices` debe listarlo).

```bash
npm run android        # genera android/, compila e instala TEINS (Dev)
```

La carpeta `android/` se **genera** desde `app.config.ts` (Continuous Native Generation):
no la edites a mano; cualquier cambio nativo va en `app.config.ts` o en un config plugin.
Si compilas en local un build de staging/producción, sincroniza antes los números de build
remotos: `npx eas-cli@latest build:version:sync`.

---

## 5. iOS desde Windows

Sin Mac **no** se puede compilar iOS en local ni abrir el simulador. Lo que sí se puede:

- Compilar en la nube con EAS: `npm run build:dev:ios`, `npm run build:preview:ios`,
  `npm run build:prod:ios`. Requiere **Apple Developer Program**; EAS pide iniciar sesión con
  el Apple ID y gestiona certificados y perfiles de aprovisionamiento.
- Para builds internos (`development`, `preview`) hay que **registrar cada iPhone**:
  `npx eas-cli@latest device:create` genera un enlace que se abre en el iPhone. Si se registra
  un dispositivo nuevo, hay que volver a compilar.
- `npm run build:dev:ios-simulator` produce un build para el simulador, que solo sirve a quien
  tenga un Mac.

No se puede sin Mac: depurar con Xcode, ver logs nativos de iOS con la consola de Xcode
(EAS muestra los logs de compilación, no los de ejecución) ni ejecutar el simulador.

---

## 6. Build `preview` (testers)

```bash
npm run build:preview:android   # APK para repartir con un enlace
npm run build:preview:ios       # ad hoc: solo iPhones registrados
```

Usa `APP_ENV=staging` y las variables del entorno `preview` de EAS: se instala como
**TEINS (Staging)** junto a la versión de producción. Comparte el enlace del build con los
testers (expo.dev → Builds).

## 7. Build `production`

```bash
npm run build:prod:android      # .aab para Google Play
npm run build:prod:ios          # build para App Store Connect / TestFlight
```

El `.aab` no se instala directamente en un móvil: se sube a Google Play Console (pista de
pruebas interna primero). Para probar exactamente la configuración de producción en un
dispositivo, usa un build `preview` con las variables de producción o la pista interna de Play.

### 7.1. Versionado

- **Versión visible** (`1.0.0`): constante `APP_VERSION` en `app.config.ts`. Es la única
  fuente de verdad; súbela a mano antes de cada publicación (1.0.1 corrección, 1.1.0 función
  nueva…). La de `package.json` no se usa para la app.
- **Número de build** (`android.versionCode` / `ios.buildNumber`): lo guarda EAS en sus
  servidores (`"appVersionSource": "remote"` en `eas.json`) y lo incrementa solo en cada
  build `production` (`"autoIncrement": true`). No se escribe en `app.config.ts` ni hay que
  hacer commit.
- Consultar o fijar el número remoto: `npx eas-cli@latest build:version:get` y
  `npx eas-cli@latest build:version:set` (útil si la app ya existe en las tiendas con un
  número mayor: el nuevo debe ser siempre superior al publicado).

### 7.2. Envío a las tiendas (pendiente)

`eas.json` tiene una sección `submit.production` vacía: no hay cuentas de tienda todavía.
Para usar `eas submit` hará falta:

- **Google Play:** crear la app en Play Console, subir el **primer** `.aab` a mano, crear una
  cuenta de servicio de Google Cloud con acceso a la API de Play y añadir su JSON con
  `serviceAccountKeyPath` (ese archivo **nunca** va al repositorio).
- **App Store:** crear la app en App Store Connect y añadir `ascAppId` y `appleTeamId` (o una
  clave de API de App Store Connect).
- Fichas de tienda: descripción, capturas, política de privacidad (la app usa cámara y fotos),
  clasificación por edades y el formulario de seguridad de datos de Google Play.

---

## 8. Antes de publicar — lista de comprobación

1. [ ] Backend operativo (sección 0) y variables correctas en el entorno de EAS.
2. [ ] `npm run check` y `npm run test:coverage` en verde; `npx expo lint` sin avisos.
3. [ ] `npm run prebuild:check` sin fallos.
4. [ ] `APP_VERSION` actualizada.
5. [ ] Build `preview` instalado en al menos un Android y un iPhone, y ejecutada la guía
       completa de [Pruebas manuales en dispositivo](PRUEBAS_MANUALES.md) (todas las P1).
6. [ ] Login real, sincronización y subida de fotos contra el backend de ese ambiente.
7. [ ] Probado en la versión mínima soportada (Android 7 / iOS 16.4) si hay usuarios con ella.

---

## 9. Problemas frecuentes

| Síntoma                                                                        | Causa / solución                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El build de EAS falla con _Gradle build daemon disappeared unexpectedly_       | El servidor (4 vCPU, ~16 GB) se queda sin RAM al compilar en paralelo el código C++ de varios módulos nativos, y el sistema mata el proceso de Gradle. El perfil `development` compila con `--no-parallel --max-workers=1` (`gradleCommand` en `eas.json`) y solo para `arm64-v8a` (los teléfonos actuales). Para un emulador x86_64 en tu PC usa `npm run android` en local. Además, Skia está fijado en **2.13.1**: la 2.14.0 necesita ~9,6 GB solo para compilar su C++ y no cabe en ese servidor (corregido en Skia, pendiente de publicar; ver `expo.install.exclude` en `package.json`). |
| `npm install` falla o se corta                                                 | Red inestable. Repite `npm install`; si persiste, `npm cache verify` y vuelve a intentarlo. No borres `package-lock.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| La configuración falla con "faltan las variables obligatorias"                 | Falta una variable en el entorno de EAS del perfil (o en `.env` en local). Revisa con `env:list`. Si la creaste como `secret`, cámbiala a `sensitive`/`plaintext`.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `APP_ENV="..." no es válido`                                                   | Solo valen `development`, `staging` y `production`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| La app abre pero dice "configuración incompleta"                               | Build de desarrollo sin variables: completa `.env` (o el entorno `development` de EAS) y recompila.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Instalaste/actualizaste una librería con código nativo y la app falla al abrir | El development build no contiene el nuevo código nativo: **hay que recompilarlo** (`npm run build:dev:android` o `npm run android`). Cambiar solo JavaScript no lo requiere.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Cambiaste `app.config.ts` (permisos, icono, plugins, nombre) y no se nota      | Son cambios nativos: recompila. En local, `npx expo prebuild --clean` regenera `android/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Comportamientos raros de Metro tras cambiar dependencias                       | `npx expo start --dev-client --clear` limpia la caché del bundler. En EAS: `--clear-cache`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Build de EAS falla en "Install dependencies"                                   | Comprueba que `package-lock.json` está actualizado y subido; ejecuta `npx expo install --check`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| El móvil no conecta con `npm start`                                            | Mismo Wi‑Fi y cortafuegos de Windows permitiendo Node; o usa `--tunnel`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| "No se puede instalar: ya existe un paquete con la misma firma"                | Una variante instalada con otra firma (local vs EAS). Desinstala esa variante y vuelve a instalar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

> **Módulos nativos nuevos: informe PDF (`expo-print` y `expo-sharing`).** Desde la
> versión con «Compartir PDF» en el detalle de la visita, la app incluye estos dos
> módulos nativos. Un development build anterior **no los contiene** y el botón falla:
> compila un build nuevo (`npm run build:dev:android`, `npm run android` o el perfil
> que corresponda) antes de probarlo. No necesitan config plugin ni permisos nuevos (el
> plugin de `expo-sharing` solo sirve para _recibir_ archivos compartidos, que la app
> no usa). Pruebas: docs/PRUEBAS_MANUALES.md §23.

## 10. Limitaciones conocidas de plataforma

La documentación original pedía **Android 5** e **iOS 12**. Con Expo SDK 58 y
React Native 0.88 los mínimos reales son:

- **Android 7.0 (API 24)** — `minSdk` de React Native 0.88.
- **iOS 16.4** — objetivo mínimo de despliegue de los módulos de Expo SDK 58
  (`ExpoModulesCore.podspec`).

Los dispositivos más antiguos no pueden instalar la app. No hay forma de bajarlo sin
volver a una versión antigua de Expo/React Native.

---

## 11. Decisiones y mejoras futuras

- **Actualizaciones OTA (`expo-updates` / `eas update`)**: fuera del alcance. Hoy cualquier
  cambio, incluso solo de JavaScript, exige un build nuevo. Añadirlo en el futuro permitiría
  publicar correcciones sin pasar por las tiendas (requiere definir `runtimeVersion`).
- **`.easignore`**: existe para no subir a EAS `docs/`, tests ni utilidades de test.
  Sustituye a `.gitignore` para EAS (no se suman), así que empieza con una copia de sus
  reglas; si cambias `.gitignore`, actualiza también `.easignore`.
- **Análisis del bundle**: para inspeccionarlo de forma visual, Expo ofrece **Expo Atlas**
  (`npx expo install expo-atlas --dev` y luego `EXPO_ATLAS=true npx expo export`,
  `npx expo-atlas`). No está instalado para no añadir dependencias.
