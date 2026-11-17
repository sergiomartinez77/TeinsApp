-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 1: esquema inicial
--
-- Origen: ARCHIVOS_REFERENCIA/migrations/001_initial_schema.sql, revisado.
-- Cambios respecto al original (ver docs/BACKEND.md, "Correcciones"):
--   • Idempotente: se puede ejecutar varias veces sin error
--     (IF NOT EXISTS, CREATE OR REPLACE, bloques DO para los enums).
--   • Sin extensiones: gen_random_uuid() es nativa desde PostgreSQL 13 y
--     uuid-ossp no se usaba.
--   • handle_new_user: SECURITY DEFINER con search_path fijo y nombres
--     calificados; el rol se toma de app_metadata (solo editable con la clave
--     service_role) y NO de user_metadata (editable por el propio usuario al
--     registrarse, lo que permitía auto-asignarse "admin").
--   • form_templates: la restricción única pasa a (visit_type, version);
--     la original incluía is_active e impedía tener dos versiones inactivas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS (CREATE TYPE no admite IF NOT EXISTS: se ignora si ya existe)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    CREATE TYPE public.user_role AS ENUM ('admin', 'office', 'technician', 'client');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE public.visit_status AS ENUM (
        'assigned', 'inProgress', 'completed', 'pendingReview', 'synced'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE public.sync_status AS ENUM (
        'local', 'pendingSync', 'syncing', 'synced', 'syncError', 'conflict'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Estados de subida de fotos. Coinciden con los que escribe la app
-- (photo-uploader.ts): local → uploading → uploaded | uploadError | pendingUpload.
DO $$
BEGIN
    CREATE TYPE public.photo_sync_status AS ENUM (
        'local', 'pendingUpload', 'uploading', 'uploaded', 'uploadError'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCIÓN COMÚN: updated_at automático
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PROFILES (extiende auth.users)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    full_name   TEXT,
    role        public.user_role NOT NULL DEFAULT 'technician',
    phone       TEXT,
    avatar_url  TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Crea el perfil al registrar un usuario en auth.users.
-- SECURITY DEFINER: se ejecuta con los permisos del dueño (postgres), por eso
-- lleva search_path vacío y todos los nombres calificados con su esquema.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.user_role := 'technician';
    v_raw  TEXT := NEW.raw_app_meta_data->>'role';
BEGIN
    -- Solo se acepta un rol válido de app_metadata; si no, técnico.
    IF v_raw IN ('admin', 'office', 'technician', 'client') THEN
        v_role := v_raw::public.user_role;
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        v_role
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- La función solo debe ejecutarla el trigger, no los clientes de la API.
-- En Supabase, anon y authenticated reciben EXECUTE por privilegios por
-- defecto del esquema public, así que no basta con revocarlo a PUBLIC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- VISIT_TYPES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.visit_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER visit_types_updated_at
    BEFORE UPDATE ON public.visit_types
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- FORM_TEMPLATES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.form_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    visit_type    TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    -- Lista de secciones; llega a la app como texto JSON (PowerSync).
    sections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Una sola fila por tipo de visita y versión.
    CONSTRAINT uq_template_type_version UNIQUE (visit_type, version)
);

CREATE INDEX IF NOT EXISTS idx_form_templates_visit_type ON public.form_templates (visit_type);
CREATE INDEX IF NOT EXISTS idx_form_templates_active
    ON public.form_templates (is_active) WHERE is_active = TRUE;

CREATE OR REPLACE TRIGGER form_templates_updated_at
    BEFORE UPDATE ON public.form_templates
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- VISITS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.visits (
    -- Sin DEFAULT: el id lo genera el dispositivo (offline-first).
    id                    UUID PRIMARY KEY,
    technician_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    client_id             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    client_name           TEXT,
    title                 TEXT NOT NULL,
    description           TEXT,
    visit_type            TEXT NOT NULL,
    address               TEXT,
    status                public.visit_status NOT NULL DEFAULT 'assigned',
    sync_status           public.sync_status NOT NULL DEFAULT 'local',
    form_template_id      UUID REFERENCES public.form_templates(id) ON DELETE SET NULL,
    form_template_version INTEGER,
    observations          TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    latitude              DOUBLE PRECISION,
    longitude             DOUBLE PRECISION,

    -- completed_at solo con la visita terminada.
    CONSTRAINT chk_completed_at CHECK (
        completed_at IS NULL OR status IN ('completed', 'pendingReview', 'synced')
    )
);

CREATE INDEX IF NOT EXISTS idx_visits_technician_id ON public.visits (technician_id);
CREATE INDEX IF NOT EXISTS idx_visits_status ON public.visits (status);
CREATE INDEX IF NOT EXISTS idx_visits_created_at ON public.visits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_sync_status ON public.visits (sync_status)
    WHERE sync_status IN ('local', 'pendingSync', 'syncError');

CREATE OR REPLACE TRIGGER visits_updated_at
    BEFORE UPDATE ON public.visits
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- FORM_RESPONSES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.form_responses (
    id                UUID PRIMARY KEY,
    visit_id          UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    template_id       UUID REFERENCES public.form_templates(id) ON DELETE SET NULL,
    template_version  INTEGER NOT NULL DEFAULT 1,
    -- {"id_del_campo": valor, ...}; llega a la app como texto JSON.
    responses         JSONB NOT NULL DEFAULT '{}'::jsonb,
    sync_status       public.sync_status NOT NULL DEFAULT 'local',
    is_complete       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,

    -- Una respuesta por visita.
    CONSTRAINT uq_form_response_visit UNIQUE (visit_id)
);

CREATE INDEX IF NOT EXISTS idx_form_responses_visit_id ON public.form_responses (visit_id);

CREATE OR REPLACE TRIGGER form_responses_updated_at
    BEFORE UPDATE ON public.form_responses
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- MATERIAL_CATALOG
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.material_catalog (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    unit        TEXT NOT NULL,
    category    TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_catalog_name ON public.material_catalog (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_material_catalog_category ON public.material_catalog (category);
CREATE INDEX IF NOT EXISTS idx_material_catalog_active
    ON public.material_catalog (is_active) WHERE is_active = TRUE;
-- (El índice por code del original sobraba: UNIQUE ya crea uno.)

CREATE OR REPLACE TRIGGER material_catalog_updated_at
    BEFORE UPDATE ON public.material_catalog
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- VISIT_MATERIALS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.visit_materials (
    id             UUID PRIMARY KEY,
    visit_id       UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    material_id    UUID NOT NULL REFERENCES public.material_catalog(id) ON DELETE RESTRICT,
    material_code  TEXT NOT NULL,  -- Desnormalizado para lectura offline
    material_name  TEXT NOT NULL,
    unit           TEXT NOT NULL,
    quantity       NUMERIC(12, 3) NOT NULL,
    observations   TEXT,
    sync_status    public.sync_status NOT NULL DEFAULT 'local',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_visit_materials_visit_id ON public.visit_materials (visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_materials_material_id ON public.visit_materials (material_id);

CREATE OR REPLACE TRIGGER visit_materials_updated_at
    BEFORE UPDATE ON public.visit_materials
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- PHOTOS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.photos (
    id               UUID PRIMARY KEY,
    visit_id         UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    form_field_id    TEXT,
    local_path       TEXT NOT NULL,
    storage_path     TEXT,
    storage_url      TEXT,
    caption          TEXT,
    sync_status      public.photo_sync_status NOT NULL DEFAULT 'local',
    file_size_bytes  INTEGER,
    width            INTEGER,
    height           INTEGER,
    captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_at      TIMESTAMPTZ,

    -- storage_path y storage_url van juntos (la app los escribe a la vez).
    CONSTRAINT chk_storage_consistent CHECK (
        (storage_path IS NULL AND storage_url IS NULL) OR
        (storage_path IS NOT NULL AND storage_url IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_photos_visit_id ON public.photos (visit_id);
CREATE INDEX IF NOT EXISTS idx_photos_sync_status ON public.photos (sync_status)
    WHERE sync_status IN ('local', 'pendingUpload', 'uploadError');

-- ─────────────────────────────────────────────────────────────────────────────
-- ANNOTATIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.annotations (
    id               UUID PRIMARY KEY,
    visit_id         UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    title            TEXT,
    -- Lista de elementos del lienzo; llega a la app como texto JSON.
    elements         JSONB NOT NULL DEFAULT '[]'::jsonb,
    base_image_path  TEXT,
    canvas_width     DOUBLE PRECISION,
    canvas_height    DOUBLE PRECISION,
    sync_status      public.sync_status NOT NULL DEFAULT 'local',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Una anotación por visita.
    CONSTRAINT uq_annotation_visit UNIQUE (visit_id)
);

CREATE INDEX IF NOT EXISTS idx_annotations_visit_id ON public.annotations (visit_id);

CREATE OR REPLACE TRIGGER annotations_updated_at
    BEFORE UPDATE ON public.annotations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT_LOGS (solo anexar; sin UPDATE ni DELETE)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action        TEXT NOT NULL,      -- 'create' | 'update' | 'delete' | 'sync'
    entity_type   TEXT NOT NULL,      -- 'visit' | 'form_response' | 'photo'...
    entity_id     UUID,
    old_values    JSONB,
    new_values    JSONB,
    is_offline    BOOLEAN NOT NULL DEFAULT FALSE,
    ip_address    INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
