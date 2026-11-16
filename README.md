# TEINS App

Aplicación móvil offline-first para técnicos de campo de TEINS.
React Native + TypeScript + Expo (SDK 58) + Expo Router. Android e iOS.

El backend (Supabase + PowerSync) es el mismo de la app original y no se modifica.

## Requisitos

- Node.js 20 o superior
- Android Studio (SDK + emulador) para compilar en Android
- macOS + Xcode, o EAS Build, para compilar en iOS

La app usa módulos nativos (PowerSync, Skia), por lo que **no funciona en Expo Go**:
se ejecuta con un *development build* (`expo-dev-client`).

## Puesta en marcha

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Copiar `.env.example` como `.env` y completar los valores. `.env` no se sube al repositorio.

3. Compilar e instalar el development build:

   ```bash
   npm run android
   ```

4. En adelante, basta con iniciar el servidor de desarrollo:

   ```bash
   npm start
   ```

## Scripts

| Script | Qué hace |
|---|---|
| `npm start` | Servidor de desarrollo (development build) |
| `npm run android` / `npm run ios` | Compila y ejecuta la app nativa |
| `npm run typecheck` | Comprobación de tipos (TypeScript estricto) |
| `npm run lint` | ESLint + Prettier |
| `npm test` | Tests unitarios (Jest) |
| `npm run check` | Tipos + lint + tests |

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `SUPABASE_URL` | Sí | URL del proyecto Supabase |
| `SUPABASE_ANON_KEY` | Sí | Clave pública `anon` (nunca la `service_role`) |
| `POWERSYNC_URL` | Sí | URL de la instancia PowerSync |
| `APP_ENV` | No | `development` (por defecto), `staging`, `production` |
| `LOG_LEVEL` | No | `debug`, `info`, `warning`, `error`, `none` |

Se leen en `app.config.ts` y llegan a la app por `src/constants/config.ts`.

## Estructura

```
src/
├── app/          Pantallas y navegación (Expo Router)
├── components/   Componentes compartidos
├── features/     Módulos por dominio (auth, visits, forms, materials, photos, annotations, home, sync)
├── services/     Infraestructura (Supabase, PowerSync, almacenamiento seguro, conectividad)
├── store/        Estado global (Zustand)
├── theme/        Colores, espaciado y tipografía
├── constants/    Configuración y constantes
├── utils/        Utilidades puras
└── types/        Tipos globales
```

El alias `@/` apunta a `src/`.

## Estado de la reconstrucción

- [x] Etapa 1 — Configuración inicial del proyecto
- [x] Etapa 2 — Design system y componentes base
- [x] Etapa 3 — Infraestructura: Supabase + PowerSync
- [x] Etapa 4 — Autenticación
- [x] Etapa 5 — Sincronización
- [x] Etapa 6 — Dashboard
- [x] Etapa 7 — Visitas
- [x] Etapa 8 — Formularios dinámicos
- [x] Etapa 9 — Materiales
- [x] Etapa 10 — Fotografías
- [ ] Etapa 11 — Anotaciones
- [ ] Etapa 12 — Resumen de visita
- [ ] Etapa 13 — Validaciones y pulido
- [ ] Etapa 14 — Pruebas
- [ ] Etapa 15 — Optimización y build
