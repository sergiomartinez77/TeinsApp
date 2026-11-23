-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 9: inventario de materiales (una sola bodega)
--
-- 1. material_catalog.min_stock NUMERIC(12,3) NULL (≥ 0): cantidad mínima en
--    bodega. Por debajo, la app avisa "comprar". NULL = sin mínimo definido.
--    Solo el admin la cambia (política material_catalog_manage_admin de la
--    migración 2); el resto la lee.
--
-- 2. Tabla material_stock_movements: entradas y correcciones de bodega.
--      kind = 'purchase'   → compra; quantity > 0.
--      kind = 'adjustment' → ajuste de inventario (conteo físico, pérdida...);
--                             quantity ≠ 0, puede ser negativa.
--    note ≤ 500 caracteres. created_by = quien la registra (auth.uid()).
--    sync_status: mismo enum que el resto de tablas que escribe la app (la app
--    la crea en 'pendingSync' y la subida la deja en 'synced'); así la app
--    sabe qué movimientos aún no llegaron al servidor.
--    RLS: lectura para cualquier usuario activo; alta, cambio y borrado solo
--    admin u oficina (al crear, created_by debe ser el propio usuario).
--
-- 3. Tabla material_stock: existencias de cada material del catálogo.
--      purchased = Σ compras · adjusted = Σ ajustes ·
--      used      = Σ cantidades de visit_materials del catálogo
--                  (is_custom = FALSE; los personalizados no son de bodega) ·
--      on_hand   = purchased + adjusted − used (puede ser negativo si se
--                  registró más uso que entradas).
--    on_hand es una columna normal mantenida por los triggers, NO una columna
--    GENERATED: la replicación lógica de PostgreSQL < 18 (la que usa
--    PowerSync) no publica columnas generadas, y el valor nunca llegaría a
--    los dispositivos.
--    SOLO la escriben los triggers (funciones SECURITY DEFINER del esquema
--    private, sin EXECUTE para los clientes): ningún usuario tiene política de
--    escritura. RLS: lectura para cualquier usuario activo.
--    Triggers:
--      • material_stock_movements: INSERT / UPDATE / DELETE.
--      • visit_materials: INSERT / DELETE / UPDATE de material_id, quantity o
--        is_custom (resta la fila anterior y suma la nueva: cubre el cambio
--        de cantidad, el cambio de material y el paso a/desde personalizado).
--        Borrar una visita borra sus materiales en cascada y el trigger
--        devuelve esas cantidades a la bodega.
--      • material_catalog: INSERT crea la fila de existencias en cero.
--    Relleno al final: una fila por material del catálogo con los totales
--    recalculados desde los datos existentes. Al re-aplicar la migración se
--    recalcula todo (y solo se tocan las filas que no cuadran).
--
-- 4. PowerSync: las dos tablas entran en la publicación `powersync` y los
--    roles de replicación (powersync_role o un usuario powersync_<id> creado
--    por el panel de PowerSync) reciben SELECT. La migración 4 las incluye en
--    su SET TABLE cuando ya existen. Después de aplicarla: volver a desplegar
--    powersync/sync-config.yaml (stream `catalogos`).
--    PowerSync necesita una columna `id`: el stream la obtiene con
--    `SELECT material_id AS id` (material_id es la clave primaria).
--
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS /
-- restricciones creadas solo si faltan.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Mínimo de bodega en el catálogo ─────────────────────────────────────
ALTER TABLE public.material_catalog
    ADD COLUMN IF NOT EXISTS min_stock NUMERIC(12, 3);

COMMENT ON COLUMN public.material_catalog.min_stock IS
    'Cantidad mínima en bodega; por debajo la app sugiere comprar. NULL = sin mínimo.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_material_min_stock'
          AND conrelid = 'public.material_catalog'::regclass
    ) THEN
        ALTER TABLE public.material_catalog
            ADD CONSTRAINT chk_material_min_stock CHECK (min_stock IS NULL OR min_stock >= 0);
    END IF;
END
$$;

-- ── 2. Movimientos de bodega ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.material_stock_movements (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id  UUID NOT NULL REFERENCES public.material_catalog(id) ON DELETE RESTRICT,
    kind         TEXT NOT NULL,
    quantity     NUMERIC(12, 3) NOT NULL,
    note         TEXT,
    created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
    sync_status  public.sync_status NOT NULL DEFAULT 'synced',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.material_stock_movements IS
    'Compras y ajustes de la bodega. El uso en visitas sale de visit_materials.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_stock_movement_kind'
          AND conrelid = 'public.material_stock_movements'::regclass
    ) THEN
        ALTER TABLE public.material_stock_movements
            ADD CONSTRAINT chk_stock_movement_kind CHECK (kind IN ('purchase', 'adjustment'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_stock_movement_quantity'
          AND conrelid = 'public.material_stock_movements'::regclass
    ) THEN
        ALTER TABLE public.material_stock_movements
            ADD CONSTRAINT chk_stock_movement_quantity CHECK (
                (kind = 'purchase' AND quantity > 0)
                OR (kind = 'adjustment' AND quantity <> 0)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_stock_movement_note'
          AND conrelid = 'public.material_stock_movements'::regclass
    ) THEN
        ALTER TABLE public.material_stock_movements
            ADD CONSTRAINT chk_stock_movement_note
            CHECK (note IS NULL OR char_length(note) <= 500);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_stock_movements_material_id
    ON public.material_stock_movements (material_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at
    ON public.material_stock_movements (created_at DESC);

CREATE OR REPLACE TRIGGER material_stock_movements_updated_at
    BEFORE UPDATE ON public.material_stock_movements
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.material_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_select_active" ON public.material_stock_movements;
CREATE POLICY "stock_movements_select_active"
    ON public.material_stock_movements FOR SELECT TO authenticated
    USING (coalesce((SELECT private.current_user_is_active()), FALSE));

DROP POLICY IF EXISTS "stock_movements_insert_admin_office" ON public.material_stock_movements;
CREATE POLICY "stock_movements_insert_admin_office"
    ON public.material_stock_movements FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT private.is_admin_or_office())
        AND created_by = (SELECT auth.uid())
    );

DROP POLICY IF EXISTS "stock_movements_update_admin_office" ON public.material_stock_movements;
CREATE POLICY "stock_movements_update_admin_office"
    ON public.material_stock_movements FOR UPDATE TO authenticated
    USING ((SELECT private.is_admin_or_office()))
    WITH CHECK ((SELECT private.is_admin_or_office()));

DROP POLICY IF EXISTS "stock_movements_delete_admin_office" ON public.material_stock_movements;
CREATE POLICY "stock_movements_delete_admin_office"
    ON public.material_stock_movements FOR DELETE TO authenticated
    USING ((SELECT private.is_admin_or_office()));

REVOKE ALL ON public.material_stock_movements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_stock_movements TO authenticated;
GRANT ALL ON public.material_stock_movements TO service_role;

-- ── 3. Existencias por material ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.material_stock (
    material_id  UUID PRIMARY KEY REFERENCES public.material_catalog(id) ON DELETE CASCADE,
    purchased    NUMERIC(14, 3) NOT NULL DEFAULT 0,
    adjusted     NUMERIC(14, 3) NOT NULL DEFAULT 0,
    used         NUMERIC(14, 3) NOT NULL DEFAULT 0,
    -- purchased + adjusted − used; lo mantienen los triggers (ver cabecera).
    on_hand      NUMERIC(14, 3) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.material_stock IS
    'Existencias en bodega por material del catálogo. Solo la escriben triggers.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_material_stock_on_hand'
          AND conrelid = 'public.material_stock'::regclass
    ) THEN
        ALTER TABLE public.material_stock
            ADD CONSTRAINT chk_material_stock_on_hand
            CHECK (on_hand = purchased + adjusted - used);
    END IF;
END
$$;

ALTER TABLE public.material_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "material_stock_select_active" ON public.material_stock;
CREATE POLICY "material_stock_select_active"
    ON public.material_stock FOR SELECT TO authenticated
    USING (coalesce((SELECT private.current_user_is_active()), FALSE));

-- Sin políticas de escritura: aunque authenticated tuviera el permiso de
-- tabla, la RLS rechazaría cualquier INSERT/UPDATE/DELETE.
REVOKE ALL ON public.material_stock FROM anon, authenticated;
GRANT SELECT ON public.material_stock TO authenticated;
GRANT ALL ON public.material_stock TO service_role;

-- ── Funciones de los triggers (esquema private, SECURITY DEFINER) ──────────

-- Suma (o resta, con valores negativos) a las existencias de un material.
CREATE OR REPLACE FUNCTION private.apply_stock_delta(
    p_material_id UUID,
    p_purchased   NUMERIC,
    p_adjusted    NUMERIC,
    p_used        NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_material_id IS NULL OR (p_purchased = 0 AND p_adjusted = 0 AND p_used = 0) THEN
        RETURN;
    END IF;

    INSERT INTO public.material_stock AS s
        (material_id, purchased, adjusted, used, on_hand, updated_at)
    VALUES
        (p_material_id, p_purchased, p_adjusted, p_used,
         p_purchased + p_adjusted - p_used, NOW())
    ON CONFLICT (material_id) DO UPDATE SET
        purchased  = s.purchased + EXCLUDED.purchased,
        adjusted   = s.adjusted + EXCLUDED.adjusted,
        used       = s.used + EXCLUDED.used,
        on_hand    = (s.purchased + EXCLUDED.purchased)
                   + (s.adjusted + EXCLUDED.adjusted)
                   - (s.used + EXCLUDED.used),
        updated_at = NOW();
END;
$$;

-- Compras y ajustes: resta la fila anterior y suma la nueva.
CREATE OR REPLACE FUNCTION private.stock_from_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM private.apply_stock_delta(
            OLD.material_id,
            CASE WHEN OLD.kind = 'purchase' THEN -OLD.quantity ELSE 0 END,
            CASE WHEN OLD.kind = 'adjustment' THEN -OLD.quantity ELSE 0 END,
            0
        );
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM private.apply_stock_delta(
            NEW.material_id,
            CASE WHEN NEW.kind = 'purchase' THEN NEW.quantity ELSE 0 END,
            CASE WHEN NEW.kind = 'adjustment' THEN NEW.quantity ELSE 0 END,
            0
        );
    END IF;
    RETURN NULL;
END;
$$;

-- Uso en visitas (solo materiales del catálogo): resta la fila anterior y
-- suma la nueva.
CREATE OR REPLACE FUNCTION private.stock_from_visit_material()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND NOT OLD.is_custom AND OLD.material_id IS NOT NULL THEN
        PERFORM private.apply_stock_delta(OLD.material_id, 0, 0, -OLD.quantity);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NOT NEW.is_custom AND NEW.material_id IS NOT NULL THEN
        PERFORM private.apply_stock_delta(NEW.material_id, 0, 0, NEW.quantity);
    END IF;
    RETURN NULL;
END;
$$;

-- Material nuevo en el catálogo: fila de existencias en cero.
CREATE OR REPLACE FUNCTION private.stock_for_new_material()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.material_stock (material_id)
    VALUES (NEW.id)
    ON CONFLICT (material_id) DO NOTHING;
    RETURN NULL;
END;
$$;

-- Solo los triggers las ejecutan (la migración 2 concede EXECUTE sobre todo el
-- esquema private a authenticated: aquí se retira para estas cuatro).
REVOKE EXECUTE ON FUNCTION private.apply_stock_delta(UUID, NUMERIC, NUMERIC, NUMERIC)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.stock_from_movement() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.stock_from_visit_material() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.stock_for_new_material() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER material_stock_movements_stock
    AFTER INSERT OR UPDATE OR DELETE ON public.material_stock_movements
    FOR EACH ROW EXECUTE FUNCTION private.stock_from_movement();

CREATE OR REPLACE TRIGGER visit_materials_stock
    AFTER INSERT OR DELETE OR UPDATE OF material_id, quantity, is_custom
    ON public.visit_materials
    FOR EACH ROW EXECUTE FUNCTION private.stock_from_visit_material();

CREATE OR REPLACE TRIGGER material_catalog_stock
    AFTER INSERT ON public.material_catalog
    FOR EACH ROW EXECUTE FUNCTION private.stock_for_new_material();

-- ── Relleno / recálculo desde los datos existentes ─────────────────────────
WITH totals AS (
    SELECT
        c.id AS material_id,
        coalesce((SELECT sum(m.quantity) FROM public.material_stock_movements m
                  WHERE m.material_id = c.id AND m.kind = 'purchase'), 0) AS purchased,
        coalesce((SELECT sum(m.quantity) FROM public.material_stock_movements m
                  WHERE m.material_id = c.id AND m.kind = 'adjustment'), 0) AS adjusted,
        coalesce((SELECT sum(vm.quantity) FROM public.visit_materials vm
                  WHERE vm.material_id = c.id AND NOT vm.is_custom), 0) AS used
    FROM public.material_catalog c
)
INSERT INTO public.material_stock AS s
    (material_id, purchased, adjusted, used, on_hand, updated_at)
SELECT material_id, purchased, adjusted, used, purchased + adjusted - used, NOW()
FROM totals
ON CONFLICT (material_id) DO UPDATE SET
    purchased  = EXCLUDED.purchased,
    adjusted   = EXCLUDED.adjusted,
    used       = EXCLUDED.used,
    on_hand    = EXCLUDED.on_hand,
    updated_at = NOW()
WHERE s.purchased IS DISTINCT FROM EXCLUDED.purchased
   OR s.adjusted IS DISTINCT FROM EXCLUDED.adjusted
   OR s.used IS DISTINCT FROM EXCLUDED.used
   OR s.on_hand IS DISTINCT FROM EXCLUDED.on_hand;

-- ── 4. PowerSync ────────────────────────────────────────────────────────────
-- Si la publicación no existe (proyecto sin la migración 4), no se hace nada:
-- la migración 4 la crea y, al re-aplicarla, ya incluye estas tablas.
DO $$
DECLARE
    v_table TEXT;
    v_role  TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
        FOREACH v_table IN ARRAY ARRAY['material_stock', 'material_stock_movements'] LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = v_table
            ) THEN
                EXECUTE format('ALTER PUBLICATION powersync ADD TABLE public.%I', v_table);
            END IF;
        END LOOP;
    END IF;

    -- powersync_role (migración 4) y, si existe, el usuario powersync_<id> que
    -- crea el asistente de PowerSync (docs/BACKEND.md, paso 5).
    FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'powersync%' LOOP
        EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_role);
        EXECUTE format(
            'GRANT SELECT ON public.material_stock, public.material_stock_movements TO %I',
            v_role
        );
    END LOOP;
END
$$;
