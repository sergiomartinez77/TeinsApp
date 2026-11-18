-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 6: materiales personalizados en la visita
--
-- El técnico puede registrar en UNA visita un material que no está en el
-- catálogo (nombre y unidad escritos por él). El catálogo no se toca: sigue
-- siendo de solo lectura para el técnico.
--
-- Cambios en visit_materials:
--   • material_id admite NULL (un material personalizado no tiene fila en
--     material_catalog). La clave foránea se mantiene para los del catálogo.
--   • is_custom BOOLEAN NOT NULL DEFAULT FALSE.
--   • chk_visit_material_source: un material es del catálogo (material_id con
--     valor, is_custom = FALSE) o personalizado (material_id NULL,
--     is_custom = TRUE). Es la regla "material_id IS NOT NULL salvo si
--     is_custom", más estricta: un personalizado tampoco puede apuntar al
--     catálogo.
--   • chk_visit_material_custom_text: el personalizado tiene nombre (1–120) y
--     unidad (1–20) no vacíos (los mismos límites que la app).
--   • uq_visit_material_custom: dos personalizados con el mismo nombre y unidad
--     (sin distinguir mayúsculas ni espacios al principio o al final) no
--     pueden repetirse en la misma visita. La app aplica la misma regla antes
--     de guardar (y algo más estricta), así que el servidor no rechaza lo que
--     la app acepta.
--
-- Datos existentes: todas las filas actuales son del catálogo y reciben
-- is_custom = FALSE por el valor por defecto (ADD COLUMN no dispara triggers
-- ni cambia updated_at). Cumplen las restricciones nuevas.
-- Idempotente: IF NOT EXISTS y restricciones creadas solo si faltan.
-- RLS: no cambia. Las políticas de visit_materials dependen solo de visit_id
-- (private.owns_visit), no de material_id: el técnico puede crear, editar y
-- quitar personalizados en sus visitas (comprobado en supabase/tests/validate.mjs).
-- PowerSync: la consulta de visit_materials enumera columnas; se añade
-- is_custom en powersync/sync-config.yaml (llega como 1/0).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.visit_materials ALTER COLUMN material_id DROP NOT NULL;

ALTER TABLE public.visit_materials
    ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.visit_materials.is_custom IS
    'TRUE: material escrito por el técnico solo para esta visita (sin fila en material_catalog).';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_visit_material_source'
          AND conrelid = 'public.visit_materials'::regclass
    ) THEN
        ALTER TABLE public.visit_materials ADD CONSTRAINT chk_visit_material_source CHECK (
            (is_custom AND material_id IS NULL) OR (NOT is_custom AND material_id IS NOT NULL)
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_visit_material_custom_text'
          AND conrelid = 'public.visit_materials'::regclass
    ) THEN
        ALTER TABLE public.visit_materials ADD CONSTRAINT chk_visit_material_custom_text CHECK (
            NOT is_custom OR (
                char_length(btrim(material_name)) BETWEEN 1 AND 120
                AND char_length(btrim(unit)) BETWEEN 1 AND 20
            )
        );
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_material_custom
    ON public.visit_materials (visit_id, lower(btrim(material_name)), lower(btrim(unit)))
    WHERE is_custom;
