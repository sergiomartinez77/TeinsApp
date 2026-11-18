-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 7: varios formularios por visita (uno por plantilla)
--
-- Antes: UNIQUE (visit_id) → una visita, un formulario.
-- Ahora: varios formularios por visita, como máximo UNO POR PLANTILLA.
--
-- La plantilla de una respuesta se identifica con `template_key` (TEXT):
--   • plantilla de la base: su UUID en texto (= template_id::text);
--   • plantilla de respaldo incluida en la app (asset): su id de texto, que la
--     app guarda con template_id = NULL y la clave reservada `__template_key`
--     dentro de `responses`.
-- Una columna de texto sirve para los dos casos (template_id es una clave
-- foránea UUID y no puede guardar el id del asset).
--
-- Cambios en form_responses:
--   1. Columna template_key TEXT.
--   2. Relleno de las filas existentes:
--        template_key = COALESCE(template_id::text, responses->>'__template_key')
--      con el trigger de updated_at desactivado durante el relleno, para no
--      cambiar la fecha de modificación de las respuestas. Si una fila antigua
--      no tiene ninguno de los dos (plantilla borrada), queda en NULL: la app
--      la sigue mostrando con la plantilla del tipo de visita, como antes.
--   3. Trigger private.set_form_response_template_key: si una escritura llega
--      sin template_key (p. ej. una versión anterior de la app que aún no
--      conoce la columna), lo calcula igual que el relleno.
--   4. Se quita uq_form_response_visit y se añade
--      uq_form_response_visit_template UNIQUE (visit_id, template_key).
--      Las filas existentes cumplen la nueva regla (había una por visita).
--
-- Idempotente: IF NOT EXISTS / DROP ... IF EXISTS / restricción creada solo si
-- falta; el relleno solo toca filas con template_key NULL.
-- RLS: no cambia (las políticas dependen de visit_id).
-- PowerSync: la consulta de form_responses es `SELECT *`; template_key se
-- sincroniza sola.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS template_key TEXT;

COMMENT ON COLUMN public.form_responses.template_key IS
    'Plantilla de la respuesta: UUID de form_templates en texto o id de la plantilla de respaldo de la app.';

-- ── Relleno de las filas existentes (sin tocar updated_at) ─────────────────
ALTER TABLE public.form_responses DISABLE TRIGGER form_responses_updated_at;

UPDATE public.form_responses
SET template_key = COALESCE(template_id::text, NULLIF(btrim(responses->>'__template_key'), ''))
WHERE template_key IS NULL
  AND COALESCE(template_id::text, NULLIF(btrim(responses->>'__template_key'), '')) IS NOT NULL;

ALTER TABLE public.form_responses ENABLE TRIGGER form_responses_updated_at;

-- ── Cálculo automático para escrituras sin template_key ────────────────────
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.set_form_response_template_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.template_key IS NULL OR btrim(NEW.template_key) = '' THEN
        NEW.template_key := COALESCE(
            NEW.template_id::text,
            NULLIF(btrim(NEW.responses->>'__template_key'), '')
        );
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.set_form_response_template_key() FROM PUBLIC, anon;

CREATE OR REPLACE TRIGGER form_responses_template_key
    BEFORE INSERT OR UPDATE ON public.form_responses
    FOR EACH ROW EXECUTE FUNCTION private.set_form_response_template_key();

-- ── Unicidad: una respuesta por visita y plantilla ─────────────────────────
ALTER TABLE public.form_responses DROP CONSTRAINT IF EXISTS uq_form_response_visit;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_form_response_visit_template'
          AND conrelid = 'public.form_responses'::regclass
    ) THEN
        ALTER TABLE public.form_responses
            ADD CONSTRAINT uq_form_response_visit_template UNIQUE (visit_id, template_key);
    END IF;
END
$$;
