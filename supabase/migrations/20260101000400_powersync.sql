-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 4: replicación para PowerSync
--
-- Origen: ARCHIVOS_REFERENCIA/migrations/004_powersync_config.sql, revisado
-- según la guía oficial Supabase + PowerSync
-- (https://docs.powersync.com/integrations/supabase/guide).
--
-- • Supabase ya trae wal_level = logical: no hay que cambiar nada.
-- • Publicación `powersync` (el nombre es obligatorio) con SOLO las 9 tablas
--   que sincroniza la app (no audit_logs). Si ya existe, se fija su lista
--   (incluidas las tablas de migraciones posteriores que ya existan, p. ej.
--   annotation_figures; ver 20261122000100_planos_y_figuras.sql, y
--   material_stock / material_stock_movements; ver 20261122000200_inventario.sql).
-- • Rol dedicado `powersync_role` con REPLICATION, BYPASSRLS y LOGIN, y solo
--   SELECT sobre esas 9 tablas. El original usaba el usuario `postgres`.
--
-- CONTRASEÑA: este archivo NO la contiene (estaría en el repositorio). Después
-- de aplicar la migración, en el editor SQL del panel ejecuta UNA vez, con una
-- contraseña larga y aleatoria que guardarás en un gestor de contraseñas:
--
--     ALTER ROLE powersync_role WITH PASSWORD '<contraseña-larga-aleatoria>';
--
-- y úsala solo en la conexión de PowerSync (docs/BACKEND.md, paso 5).
-- Sin ese paso el rol no puede iniciar sesión.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Publicación ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
        CREATE PUBLICATION powersync FOR TABLE
            public.profiles,
            public.visit_types,
            public.form_templates,
            public.visits,
            public.form_responses,
            public.material_catalog,
            public.visit_materials,
            public.photos,
            public.annotations;
    ELSE
        -- SET TABLE fija la lista y quitaría las tablas añadidas por migraciones
        -- posteriores al re-aplicar esta: las que ya existen se incluyen aquí.
        --   • annotation_figures (migración 20261122000100_planos_y_figuras).
        --   • material_stock y material_stock_movements (migración
        --     20261122000200_inventario).
        EXECUTE 'ALTER PUBLICATION powersync SET TABLE '
            || 'public.profiles, public.visit_types, public.form_templates, '
            || 'public.visits, public.form_responses, public.material_catalog, '
            || 'public.visit_materials, public.photos, public.annotations'
            || CASE WHEN to_regclass('public.annotation_figures') IS NOT NULL
                    THEN ', public.annotation_figures' ELSE '' END
            || CASE WHEN to_regclass('public.material_stock') IS NOT NULL
                    THEN ', public.material_stock' ELSE '' END
            || CASE WHEN to_regclass('public.material_stock_movements') IS NOT NULL
                    THEN ', public.material_stock_movements' ELSE '' END;
    END IF;
END
$$;

-- ── Rol de replicación (sin contraseña en el repositorio) ───────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
        CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN;
    ELSE
        ALTER ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO powersync_role;
GRANT SELECT ON
    public.profiles,
    public.visit_types,
    public.form_templates,
    public.visits,
    public.form_responses,
    public.material_catalog,
    public.visit_materials,
    public.photos,
    public.annotations
TO powersync_role;

-- ── Índices de apoyo ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_visits_updated_at ON public.visits (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_responses_updated_at ON public.form_responses (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_visit_materials_updated_at ON public.visit_materials (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_captured_at ON public.photos (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_annotations_updated_at ON public.annotations (updated_at DESC);
