-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 8: varios planos por visita y biblioteca de figuras
--
-- 1. Varios planos por visita (tabla annotations).
--    Antes: UNIQUE (visit_id) → una visita, un plano.
--    Ahora: una visita puede tener varios planos. Se quita uq_annotation_visit;
--    el índice idx_annotations_visit_id (migración 1) se queda para las
--    consultas por visita. Las filas existentes no cambian.
--
-- 2. Formato de los elementos del plano: columna format_version.
--      1 = puntos normalizados 0–1 respecto a canvas_width/canvas_height
--          (formato antiguo; valor por defecto, así las filas existentes y las
--          escrituras de versiones anteriores de la app quedan en 1);
--      2 = coordenadas del plano en centímetros, sin límites; los grosores de
--          trazo van en píxeles de pantalla.
--    CHECK ck_annotation_format_version: solo 1 o 2.
--
-- 3. Borrado de planos: ahora la app borra planos, así que el técnico puede
--    borrar los de SUS visitas (annotations_delete_own_technician, igual que
--    photos_delete_own_technician en la migración 2).
--
-- 4. Tabla nueva annotation_figures: figuras que cada técnico guarda para
--    reutilizarlas en otras visitas. No depende de ninguna visita: es del
--    técnico (technician_id). RLS: cada técnico ve, crea, modifica y borra
--    SOLO las suyas; oficina y admin no las ven (son una herramienta personal).
--    elements tiene el mismo formato que annotations.elements (versión 2);
--    width/height = tamaño de la figura en centímetros.
--
-- 5. PowerSync: annotation_figures entra en la publicación `powersync` y
--    powersync_role puede leerla (SELECT). La migración 4 fija la lista de la
--    publicación con SET TABLE; para que al re-aplicarla no se quite esta
--    tabla, la migración 4 la incluye en esa lista cuando ya existe. Esta
--    migración, además, la añade si aún no está.
--    Después de aplicarla: volver a desplegar powersync/sync-config.yaml
--    (stream nuevo `mis_figuras`).
--
-- Idempotente: IF NOT EXISTS / DROP ... IF EXISTS / restricciones creadas solo
-- si faltan; la tabla se añade a la publicación solo si aún no está.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Varios planos por visita ────────────────────────────────────────────
ALTER TABLE public.annotations DROP CONSTRAINT IF EXISTS uq_annotation_visit;

-- ── 2. Versión del formato de los elementos ────────────────────────────────
ALTER TABLE public.annotations
    ADD COLUMN IF NOT EXISTS format_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.annotations.format_version IS
    '1 = puntos normalizados 0–1 respecto a canvas_width/canvas_height (formato antiguo); '
    '2 = coordenadas del plano en centímetros, sin límites, grosores en píxeles de pantalla.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_annotation_format_version'
          AND conrelid = 'public.annotations'::regclass
    ) THEN
        ALTER TABLE public.annotations
            ADD CONSTRAINT ck_annotation_format_version CHECK (format_version IN (1, 2));
    END IF;
END
$$;

-- ── 3. El técnico borra planos de sus visitas ──────────────────────────────
DROP POLICY IF EXISTS "annotations_delete_own_technician" ON public.annotations;
CREATE POLICY "annotations_delete_own_technician"
    ON public.annotations FOR DELETE TO authenticated
    USING (private.owns_visit(visit_id::text));

-- ── 4. Biblioteca de figuras de cada técnico ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.annotation_figures (
    id             UUID PRIMARY KEY,
    technician_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    -- Elementos de la figura; llegan a la app como texto JSON.
    elements       JSONB NOT NULL DEFAULT '[]'::jsonb,
    width          DOUBLE PRECISION NOT NULL DEFAULT 0,
    height         DOUBLE PRECISION NOT NULL DEFAULT 0,
    sync_status    public.sync_status NOT NULL DEFAULT 'local',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.annotation_figures IS
    'Figuras guardadas por cada técnico para reutilizarlas en los planos de otras visitas.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_annotation_figure_name'
          AND conrelid = 'public.annotation_figures'::regclass
    ) THEN
        ALTER TABLE public.annotation_figures
            ADD CONSTRAINT ck_annotation_figure_name
            CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_annotation_figures_technician_id
    ON public.annotation_figures (technician_id);

CREATE OR REPLACE TRIGGER annotation_figures_updated_at
    BEFORE UPDATE ON public.annotation_figures
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS: cada técnico, solo sus figuras.
ALTER TABLE public.annotation_figures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "annotation_figures_select_own" ON public.annotation_figures;
CREATE POLICY "annotation_figures_select_own"
    ON public.annotation_figures FOR SELECT TO authenticated
    USING (technician_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "annotation_figures_insert_own" ON public.annotation_figures;
CREATE POLICY "annotation_figures_insert_own"
    ON public.annotation_figures FOR INSERT TO authenticated
    WITH CHECK (technician_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "annotation_figures_update_own" ON public.annotation_figures;
CREATE POLICY "annotation_figures_update_own"
    ON public.annotation_figures FOR UPDATE TO authenticated
    USING (technician_id = (SELECT auth.uid()))
    WITH CHECK (technician_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "annotation_figures_delete_own" ON public.annotation_figures;
CREATE POLICY "annotation_figures_delete_own"
    ON public.annotation_figures FOR DELETE TO authenticated
    USING (technician_id = (SELECT auth.uid()));

-- Permisos de tabla explícitos (como en la migración 2).
REVOKE ALL ON public.annotation_figures FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotation_figures TO authenticated;
GRANT ALL ON public.annotation_figures TO service_role;

-- ── 5. PowerSync ────────────────────────────────────────────────────────────
-- Si la publicación no existe (proyecto sin la migración 4), no se hace nada:
-- la migración 4 la crea y, al re-aplicarla, ya incluye esta tabla.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'powersync'
             AND schemaname = 'public'
             AND tablename = 'annotation_figures'
       ) THEN
        ALTER PUBLICATION powersync ADD TABLE public.annotation_figures;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
        GRANT SELECT ON public.annotation_figures TO powersync_role;
    END IF;
END
$$;
