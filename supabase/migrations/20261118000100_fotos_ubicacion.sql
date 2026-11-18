-- ═══════════════════════════════════════════════════════════════════════════
-- TEINS App — Migración 5: marca de tiempo y ubicación de las fotografías
--
-- La app imprime sobre cada foto la fecha y hora, las coordenadas y su
-- precisión. Esos mismos datos se guardan en columnas para poder consultarlos
-- sin leer la imagen:
--   • latitude / longitude: grados decimales (WGS 84).
--   • location_accuracy: radio de incertidumbre en metros.
--   • taken_at: la fecha y hora IMPRESA en la foto (la de la cámara o, para
--     fotos de galería, la de la propia foto si la trae). `captured_at` sigue
--     siendo el momento en que se registró en la app.
--
-- Todas son opcionales: las fotos que ya existen quedan con NULL (no tienen
-- marca) y una foto sin ubicación se guarda igual.
--
-- Datos existentes: ADD COLUMN sin valor por defecto no reescribe filas ni
-- dispara triggers; ninguna fila cambia.
-- Idempotente: IF NOT EXISTS y restricciones creadas solo si faltan.
-- RLS: no cambia (las políticas de photos dependen de visit_id).
-- PowerSync: la consulta de photos es `SELECT *`; las columnas nuevas se
-- sincronizan solas (la publicación replica la tabla completa).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS location_accuracy DOUBLE PRECISION;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

COMMENT ON COLUMN public.photos.latitude IS 'Latitud en grados decimales impresa en la foto (NULL = ubicación no disponible).';
COMMENT ON COLUMN public.photos.longitude IS 'Longitud en grados decimales impresa en la foto (NULL = ubicación no disponible).';
COMMENT ON COLUMN public.photos.location_accuracy IS 'Precisión de la ubicación en metros.';
COMMENT ON COLUMN public.photos.taken_at IS 'Fecha y hora impresa en la foto.';

-- Coordenadas válidas y siempre juntas; precisión no negativa.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_photo_location' AND conrelid = 'public.photos'::regclass
    ) THEN
        ALTER TABLE public.photos ADD CONSTRAINT chk_photo_location CHECK (
            (latitude IS NULL AND longitude IS NULL)
            OR (
                latitude IS NOT NULL AND longitude IS NOT NULL
                AND latitude BETWEEN -90 AND 90
                AND longitude BETWEEN -180 AND 180
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_photo_location_accuracy' AND conrelid = 'public.photos'::regclass
    ) THEN
        ALTER TABLE public.photos ADD CONSTRAINT chk_photo_location_accuracy CHECK (
            location_accuracy IS NULL OR location_accuracy >= 0
        );
    END IF;
END
$$;
