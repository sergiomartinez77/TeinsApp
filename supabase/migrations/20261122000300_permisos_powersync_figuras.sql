-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 10: lectura de annotation_figures para PowerSync
--
-- La migración 8 (planos y figuras) solo concede SELECT a powersync_role. El
-- panel de PowerSync crea además su propio usuario de replicación
-- (powersync_<id>, ver docs/BACKEND.md); sin este permiso, las figuras nunca
-- llegarían a los dispositivos. Se concede a todos los roles powersync%.
-- Idempotente: GRANT repetido no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_role TEXT;
BEGIN
    FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'powersync%' LOOP
        EXECUTE format('GRANT SELECT ON public.annotation_figures TO %I', v_role);
    END LOOP;
END
$$;
