-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 2: permisos y Row Level Security (RLS)
--
-- Origen: ARCHIVOS_REFERENCIA/migrations/002_rls_policies.sql, revisado.
-- Principios: RLS en todas las tablas, sin política = sin acceso, la app
-- móvil nunca usa service_role, acceso mínimo por rol.
--
-- Cambios respecto al original (detalle en docs/BACKEND.md):
--   • Funciones auxiliares en el esquema `private` (no expuesto por la API),
--     SECURITY DEFINER, STABLE y con search_path fijo. Las políticas ya no
--     consultan `profiles` ni `visits` directamente: así no hay recursión
--     infinita de RLS ni coste de evaluar RLS anidado.
--   • visits_update_own_technician: la subconsulta original
--     `(SELECT technician_id FROM visits WHERE id = visits.id)` comparaba la
--     tabla consigo misma (devolvía todas las filas → error "more than one
--     row" con dos visitas o más). Se elimina: WITH CHECK technician_id =
--     auth.uid() ya impide reasignar la visita a otro técnico.
--   • profiles_update_own: se reescribe con funciones auxiliares (el original
--     consultaba `profiles` dentro de una política de `profiles`).
--   • Políticas FOR ALL de las tablas hijas separadas por operación: el
--     técnico puede SELECT/INSERT/UPDATE (upsert de PostgREST) en las filas de
--     sus visitas, y DELETE solo en visit_materials y photos, que es lo que
--     borra la app. Ya no puede borrar form_responses ni annotations.
--   • Admin/oficina pueden crear visitas (la app permite crear al admin).
--   • Todas las políticas con `TO authenticated` y `(select auth.uid())`
--     (recomendación de rendimiento de Supabase).
--   • Permisos de tabla explícitos (GRANT): no se depende de los permisos por
--     defecto del proyecto; `anon` no tiene ningún permiso.
--   • Idempotente: DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos de tabla (la RLS filtra después las filas)
-- ─────────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

REVOKE ALL ON
    public.profiles, public.visit_types, public.form_templates, public.visits,
    public.form_responses, public.material_catalog, public.visit_materials,
    public.photos, public.annotations, public.audit_logs
FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.profiles, public.visit_types, public.form_templates, public.visits,
    public.form_responses, public.material_catalog, public.visit_materials,
    public.photos, public.annotations, public.audit_logs
TO authenticated;

GRANT ALL ON
    public.profiles, public.visit_types, public.form_templates, public.visits,
    public.form_responses, public.material_catalog, public.visit_materials,
    public.photos, public.annotations, public.audit_logs
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.audit_logs_id_seq TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Funciones auxiliares (esquema privado)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Elimina las funciones públicas del original si existían (se podían llamar
-- por RPC desde la API).
DROP FUNCTION IF EXISTS public.get_user_role();
DROP FUNCTION IF EXISTS public.is_technician();
DROP FUNCTION IF EXISTS public.is_admin_or_office();

-- Rol del usuario actual (NULL si no tiene perfil).
CREATE OR REPLACE FUNCTION private.current_user_role()
RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.role FROM public.profiles p WHERE p.id = (SELECT auth.uid());
$$;

-- is_active del usuario actual (NULL si no tiene perfil).
CREATE OR REPLACE FUNCTION private.current_user_is_active()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.is_active FROM public.profiles p WHERE p.id = (SELECT auth.uid());
$$;

-- ¿Es técnico activo?
CREATE OR REPLACE FUNCTION private.is_technician()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid()) AND p.role = 'technician' AND p.is_active
    );
$$;

-- ¿Es admin u oficina activo?
CREATE OR REPLACE FUNCTION private.is_admin_or_office()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'office') AND p.is_active
    );
$$;

-- ¿Es admin activo?
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin' AND p.is_active
    );
$$;

-- ¿La visita es del técnico actual (y está activo)? Se usa en las tablas hijas
-- y en Storage. Recibe texto para poder usarse con segmentos de la ruta del
-- archivo sin que un valor que no es UUID provoque un error de conversión.
CREATE OR REPLACE FUNCTION private.owns_visit(p_visit_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.visits v
        JOIN public.profiles p ON p.id = v.technician_id
        WHERE v.id::text = lower(p_visit_id)
          AND v.technician_id = (SELECT auth.uid())
          AND p.role = 'technician'
          AND p.is_active
    );
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT TO authenticated
    USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "profiles_select_all_admin_office" ON public.profiles;
CREATE POLICY "profiles_select_all_admin_office"
    ON public.profiles FOR SELECT TO authenticated
    USING ((SELECT private.is_admin_or_office()));

-- Cada usuario edita su perfil, pero sin cambiar su rol ni is_active.
-- Las funciones leen la fila ANTERIOR (instantánea de la sentencia).
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE TO authenticated
    USING (id = (SELECT auth.uid()))
    WITH CHECK (
        id = (SELECT auth.uid())
        AND role = (SELECT private.current_user_role())
        AND is_active = (SELECT private.current_user_is_active())
    );

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin"
    ON public.profiles FOR UPDATE TO authenticated
    USING ((SELECT private.is_admin()))
    WITH CHECK ((SELECT private.is_admin()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogos: VISIT_TYPES, FORM_TEMPLATES, MATERIAL_CATALOG
-- Lectura de las filas activas para autenticados; gestión solo admin.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.visit_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visit_types_select_authenticated" ON public.visit_types;
CREATE POLICY "visit_types_select_authenticated"
    ON public.visit_types FOR SELECT TO authenticated
    USING (is_active = TRUE);

DROP POLICY IF EXISTS "visit_types_manage_admin" ON public.visit_types;
CREATE POLICY "visit_types_manage_admin"
    ON public.visit_types FOR ALL TO authenticated
    USING ((SELECT private.is_admin()))
    WITH CHECK ((SELECT private.is_admin()));

ALTER TABLE public.form_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_templates_select_authenticated" ON public.form_templates;
CREATE POLICY "form_templates_select_authenticated"
    ON public.form_templates FOR SELECT TO authenticated
    USING (is_active = TRUE);

DROP POLICY IF EXISTS "form_templates_manage_admin" ON public.form_templates;
CREATE POLICY "form_templates_manage_admin"
    ON public.form_templates FOR ALL TO authenticated
    USING ((SELECT private.is_admin()))
    WITH CHECK ((SELECT private.is_admin()));

ALTER TABLE public.material_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "material_catalog_select_authenticated" ON public.material_catalog;
CREATE POLICY "material_catalog_select_authenticated"
    ON public.material_catalog FOR SELECT TO authenticated
    USING (is_active = TRUE);

DROP POLICY IF EXISTS "material_catalog_manage_admin" ON public.material_catalog;
CREATE POLICY "material_catalog_manage_admin"
    ON public.material_catalog FOR ALL TO authenticated
    USING ((SELECT private.is_admin()))
    WITH CHECK ((SELECT private.is_admin()));

-- ─────────────────────────────────────────────────────────────────────────────
-- VISITS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visits_select_own_technician" ON public.visits;
CREATE POLICY "visits_select_own_technician"
    ON public.visits FOR SELECT TO authenticated
    USING (technician_id = (SELECT auth.uid()) AND (SELECT private.is_technician()));

DROP POLICY IF EXISTS "visits_select_all_admin_office" ON public.visits;
CREATE POLICY "visits_select_all_admin_office"
    ON public.visits FOR SELECT TO authenticated
    USING ((SELECT private.is_admin_or_office()));

-- Técnico: crea visitas asignadas a sí mismo (la app genera el id).
DROP POLICY IF EXISTS "visits_insert_technician" ON public.visits;
CREATE POLICY "visits_insert_technician"
    ON public.visits FOR INSERT TO authenticated
    WITH CHECK (technician_id = (SELECT auth.uid()) AND (SELECT private.is_technician()));

DROP POLICY IF EXISTS "visits_insert_admin_office" ON public.visits;
CREATE POLICY "visits_insert_admin_office"
    ON public.visits FOR INSERT TO authenticated
    WITH CHECK ((SELECT private.is_admin_or_office()));

-- Técnico: actualiza sus visitas. WITH CHECK impide reasignarla a otro.
DROP POLICY IF EXISTS "visits_update_own_technician" ON public.visits;
CREATE POLICY "visits_update_own_technician"
    ON public.visits FOR UPDATE TO authenticated
    USING (technician_id = (SELECT auth.uid()) AND (SELECT private.is_technician()))
    WITH CHECK (technician_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "visits_update_admin_office" ON public.visits;
CREATE POLICY "visits_update_admin_office"
    ON public.visits FOR UPDATE TO authenticated
    USING ((SELECT private.is_admin_or_office()))
    WITH CHECK ((SELECT private.is_admin_or_office()));

-- Solo admin borra visitas (el técnico nunca).
DROP POLICY IF EXISTS "visits_delete_admin" ON public.visits;
CREATE POLICY "visits_delete_admin"
    ON public.visits FOR DELETE TO authenticated
    USING ((SELECT private.is_admin()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Tablas hijas de la visita.
-- Técnico: SELECT + INSERT + UPDATE (upsert) en las filas de sus visitas.
-- Admin/oficina: lectura de todo.
-- ─────────────────────────────────────────────────────────────────────────────

-- FORM_RESPONSES ──────────────────────────────────────────────────────────────
ALTER TABLE public.form_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_responses_own_technician" ON public.form_responses;
DROP POLICY IF EXISTS "form_responses_select_own_technician" ON public.form_responses;
CREATE POLICY "form_responses_select_own_technician"
    ON public.form_responses FOR SELECT TO authenticated
    USING (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "form_responses_insert_own_technician" ON public.form_responses;
CREATE POLICY "form_responses_insert_own_technician"
    ON public.form_responses FOR INSERT TO authenticated
    WITH CHECK (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "form_responses_update_own_technician" ON public.form_responses;
CREATE POLICY "form_responses_update_own_technician"
    ON public.form_responses FOR UPDATE TO authenticated
    USING (private.owns_visit(visit_id::text))
    WITH CHECK (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "form_responses_select_admin_office" ON public.form_responses;
CREATE POLICY "form_responses_select_admin_office"
    ON public.form_responses FOR SELECT TO authenticated
    USING ((SELECT private.is_admin_or_office()));

-- VISIT_MATERIALS (la app también los borra) ─────────────────────────────────
ALTER TABLE public.visit_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visit_materials_own_technician" ON public.visit_materials;
DROP POLICY IF EXISTS "visit_materials_select_own_technician" ON public.visit_materials;
CREATE POLICY "visit_materials_select_own_technician"
    ON public.visit_materials FOR SELECT TO authenticated
    USING (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "visit_materials_insert_own_technician" ON public.visit_materials;
CREATE POLICY "visit_materials_insert_own_technician"
    ON public.visit_materials FOR INSERT TO authenticated
    WITH CHECK (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "visit_materials_update_own_technician" ON public.visit_materials;
CREATE POLICY "visit_materials_update_own_technician"
    ON public.visit_materials FOR UPDATE TO authenticated
    USING (private.owns_visit(visit_id::text))
    WITH CHECK (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "visit_materials_delete_own_technician" ON public.visit_materials;
CREATE POLICY "visit_materials_delete_own_technician"
    ON public.visit_materials FOR DELETE TO authenticated
    USING (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "visit_materials_select_admin_office" ON public.visit_materials;
CREATE POLICY "visit_materials_select_admin_office"
    ON public.visit_materials FOR SELECT TO authenticated
    USING ((SELECT private.is_admin_or_office()));

-- PHOTOS (la app también las borra) ─────────────────────────────────────────
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "photos_own_technician" ON public.photos;
DROP POLICY IF EXISTS "photos_select_own_technician" ON public.photos;
CREATE POLICY "photos_select_own_technician"
    ON public.photos FOR SELECT TO authenticated
    USING (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "photos_insert_own_technician" ON public.photos;
CREATE POLICY "photos_insert_own_technician"
    ON public.photos FOR INSERT TO authenticated
    WITH CHECK (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "photos_update_own_technician" ON public.photos;
CREATE POLICY "photos_update_own_technician"
    ON public.photos FOR UPDATE TO authenticated
    USING (private.owns_visit(visit_id::text))
    WITH CHECK (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "photos_delete_own_technician" ON public.photos;
CREATE POLICY "photos_delete_own_technician"
    ON public.photos FOR DELETE TO authenticated
    USING (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "photos_select_admin_office" ON public.photos;
CREATE POLICY "photos_select_admin_office"
    ON public.photos FOR SELECT TO authenticated
    USING ((SELECT private.is_admin_or_office()));

-- ANNOTATIONS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "annotations_own_technician" ON public.annotations;
DROP POLICY IF EXISTS "annotations_select_own_technician" ON public.annotations;
CREATE POLICY "annotations_select_own_technician"
    ON public.annotations FOR SELECT TO authenticated
    USING (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "annotations_insert_own_technician" ON public.annotations;
CREATE POLICY "annotations_insert_own_technician"
    ON public.annotations FOR INSERT TO authenticated
    WITH CHECK (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "annotations_update_own_technician" ON public.annotations;
CREATE POLICY "annotations_update_own_technician"
    ON public.annotations FOR UPDATE TO authenticated
    USING (private.owns_visit(visit_id::text))
    WITH CHECK (private.owns_visit(visit_id::text));

DROP POLICY IF EXISTS "annotations_select_admin_office" ON public.annotations;
CREATE POLICY "annotations_select_admin_office"
    ON public.annotations FOR SELECT TO authenticated
    USING ((SELECT private.is_admin_or_office()));

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT_LOGS — lectura solo admin; escritura solo con service_role
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin"
    ON public.audit_logs FOR SELECT TO authenticated
    USING ((SELECT private.is_admin()));
