-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 3: Storage (bucket de fotos y políticas)
--
-- Origen: ARCHIVOS_REFERENCIA/migrations/003_storage_policies.sql, revisado.
-- Ruta que usa la app (photoStoragePath):  visits/<visitId>/photos/<photoId>.jpg
-- La app sube con `upsert: true`; según la documentación de Supabase Storage,
-- el upsert necesita políticas INSERT + SELECT + UPDATE.
--
-- Cambios respecto al original:
--   • Se usa storage.foldername(name) (función auxiliar recomendada por
--     Supabase) en vez de recorrer todas las visitas con starts_with: la
--     ruta debe ser exactamente visits/<id>/photos/<archivo>.
--   • La comprobación de la visita va en private.owns_visit (SECURITY DEFINER),
--     sin consultar public.visits / public.profiles con RLS desde Storage.
--   • UPDATE con WITH CHECK (el original no lo tenía: permitía mover un
--     objeto a una ruta ajena).
--   • El bucket se reafirma privado en cada ejecución (ON CONFLICT ... public).
--   • Idempotente (DROP POLICY IF EXISTS).
-- El técnico NO borra objetos remotos (la app no lo hace); solo admin.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'visit-photos',
    'visit-photos',
    FALSE,   -- Privado: lectura con sesión o URL firmada
    5242880, -- 5 MB por archivo
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public             = FALSE,
    file_size_limit    = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Lectura: técnico sus visitas; admin/oficina todo ─────────────────────────
DROP POLICY IF EXISTS "photos_select_own_technician" ON storage.objects;
DROP POLICY IF EXISTS "visit_photos_select" ON storage.objects;
CREATE POLICY "visit_photos_select"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'visit-photos'
        AND (
            (
                (storage.foldername(name))[1] = 'visits'
                AND (storage.foldername(name))[3] = 'photos'
                AND private.owns_visit((storage.foldername(name))[2])
            )
            OR (SELECT private.is_admin_or_office())
        )
    );

-- ── Subida: solo en la carpeta de una visita propia ─────────────────────────
DROP POLICY IF EXISTS "photos_upload_technician" ON storage.objects;
DROP POLICY IF EXISTS "visit_photos_insert_technician" ON storage.objects;
CREATE POLICY "visit_photos_insert_technician"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'visit-photos'
        AND (storage.foldername(name))[1] = 'visits'
        AND (storage.foldername(name))[3] = 'photos'
        AND private.owns_visit((storage.foldername(name))[2])
    );

-- ── Sobrescritura (upsert = INSERT + SELECT + UPDATE) ───────────────────────
DROP POLICY IF EXISTS "photos_update_own_technician" ON storage.objects;
DROP POLICY IF EXISTS "visit_photos_update_technician" ON storage.objects;
CREATE POLICY "visit_photos_update_technician"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'visit-photos'
        AND (storage.foldername(name))[1] = 'visits'
        AND (storage.foldername(name))[3] = 'photos'
        AND private.owns_visit((storage.foldername(name))[2])
    )
    WITH CHECK (
        bucket_id = 'visit-photos'
        AND (storage.foldername(name))[1] = 'visits'
        AND (storage.foldername(name))[3] = 'photos'
        AND private.owns_visit((storage.foldername(name))[2])
    );

-- ── Borrado: solo admin ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "photos_delete_admin" ON storage.objects;
DROP POLICY IF EXISTS "visit_photos_delete_admin" ON storage.objects;
CREATE POLICY "visit_photos_delete_admin"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'visit-photos' AND (SELECT private.is_admin()));
