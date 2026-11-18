/**
 * Marca impresa en las fotografías: fecha y hora, coordenadas, precisión y
 * título de la visita. Lógica pura (sin dependencias nativas): textos,
 * decisiones sobre de dónde sale cada dato, lectura de EXIF y medidas.
 * El dibujado con Skia vive en `photo-stamp-renderer.ts`.
 */

/** Ubicación de la foto en grados decimales (WGS 84). */
export interface PhotoLocation {
  latitude: number;
  longitude: number;
  /** Radio de incertidumbre en metros; `null` si no se conoce. */
  accuracy: number | null;
}

/** Datos que se imprimen en la foto y se guardan en la fila. */
export interface PhotoStampData {
  /** Fecha y hora impresa (ISO 8601 UTC). */
  takenAt: string;
  location: PhotoLocation | null;
}

export const STAMP_MESSAGES = {
  noLocation: 'Ubicación no disponible',
} as const;

/** Decimales de las coordenadas impresas (≈ 0,1 m). */
export const COORDINATE_DECIMALS = 6;

/** Recorte del título: se añade este carácter al final. */
export const ELLIPSIS = '…';

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** "18/11/2026 14:35:07" en la hora LOCAL del dispositivo. */
export function formatStampDateTime(date: Date): string {
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day} ${time}`;
}

/** "-3.993421, -79.204512" (punto decimal, 6 decimales: formato estándar de coordenadas). */
export function formatCoordinates(location: Pick<PhotoLocation, 'latitude' | 'longitude'>): string {
  const format = (value: number) => {
    const text = value.toFixed(COORDINATE_DECIMALS);
    // Evita "-0.000000".
    return Number(text) === 0 ? (0).toFixed(COORDINATE_DECIMALS) : text;
  };
  return `${format(location.latitude)}, ${format(location.longitude)}`;
}

/** "±8 m" (redondeado a metros; al menos 1 m). */
export function formatAccuracy(meters: number): string {
  return `±${Math.max(1, Math.round(meters))} m`;
}

/** "-3.993421, -79.204512 ±8 m", o "Ubicación no disponible". */
export function formatLocationLine(location: PhotoLocation | null): string {
  if (!location) return STAMP_MESSAGES.noLocation;
  const coordinates = formatCoordinates(location);
  return location.accuracy === null
    ? coordinates
    : `${coordinates} ${formatAccuracy(location.accuracy)}`;
}

/** Líneas impresas, de arriba abajo: fecha y hora, ubicación y título (si hay). */
export function buildStampLines(data: PhotoStampData, visitTitle: string): string[] {
  const lines = [formatStampDateTime(new Date(data.takenAt)), formatLocationLine(data.location)];
  const title = visitTitle.replace(/\s+/g, ' ').trim();
  if (title) lines.push(title);
  return lines;
}

// ── Validación de ubicaciones ────────────────────────────────────────────────

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Ubicación válida o `null`. Se descarta (0, 0) exacto: es lo que entregan
 * los sistemas cuando borran la ubicación de una foto por privacidad.
 */
export function validLocation(
  latitude: unknown,
  longitude: unknown,
  accuracy: unknown = null,
): PhotoLocation | null {
  if (!finite(latitude) || !finite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude, accuracy: finite(accuracy) && accuracy >= 0 ? accuracy : null };
}

// ── EXIF (fotos de galería) ──────────────────────────────────────────────────

type ExifRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ExifRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Valor EXIF de nivel superior (Android) o del diccionario de iOS (`{Exif}`, `{GPS}`). */
function exifValue(exif: ExifRecord, keys: readonly string[], group?: string): unknown {
  for (const key of keys) {
    if (exif[key] !== undefined && exif[key] !== null) return exif[key];
  }
  const nested = group ? exif[group] : undefined;
  if (isRecord(nested)) {
    for (const key of keys) {
      const short = key.replace(/^GPS/, '');
      for (const candidate of [key, short]) {
        if (nested[candidate] !== undefined && nested[candidate] !== null) return nested[candidate];
      }
    }
  }
  return undefined;
}

/** Número de un valor EXIF: número, texto decimal o fracción ("5/1"). */
function rational(value: unknown): number | null {
  if (finite(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const fraction = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(text);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }
  const number = Number(text);
  return text !== '' && Number.isFinite(number) ? number : null;
}

/**
 * Coordenada EXIF en grados decimales. Acepta grados decimales (Android los
 * entrega ya con signo), "grados/1,minutos/1,segundos/100" o una lista de
 * tres números. La referencia S u O (W) vuelve negativo un valor positivo.
 */
export function exifCoordinate(value: unknown, ref: unknown): number | null {
  let degrees: number | null = null;
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.includes(',')
      ? value.split(',')
      : null;
  if (parts) {
    const [d, m = 0, s = 0] = parts.map(rational);
    if (d === null || d === undefined || m === null || s === null) return null;
    degrees = Math.abs(d) + m / 60 + s / 3600;
    if (d < 0) degrees = -degrees;
  } else {
    degrees = rational(value);
  }
  if (degrees === null) return null;
  const reference = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  if (degrees > 0 && (reference === 'S' || reference === 'W' || reference === 'O')) {
    return -degrees;
  }
  return degrees;
}

/** Ubicación de la foto según su EXIF, o `null` si no la trae (o fue borrada). */
export function locationFromExif(exif: unknown): PhotoLocation | null {
  if (!isRecord(exif)) return null;
  const latitude = exifCoordinate(
    exifValue(exif, ['GPSLatitude'], '{GPS}'),
    exifValue(exif, ['GPSLatitudeRef'], '{GPS}'),
  );
  const longitude = exifCoordinate(
    exifValue(exif, ['GPSLongitude'], '{GPS}'),
    exifValue(exif, ['GPSLongitudeRef'], '{GPS}'),
  );
  const accuracy = rational(exifValue(exif, ['GPSHPositioningError'], '{GPS}'));
  return validLocation(latitude, longitude, accuracy);
}

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

/**
 * Fecha y hora en que se tomó la foto según su EXIF ("2026:11:18 14:35:07").
 * Con `OffsetTimeOriginal` se respeta la zona; sin ella se interpreta como
 * hora local del dispositivo (así se imprime la misma hora que marca la foto).
 */
export function dateFromExif(exif: unknown): Date | null {
  if (!isRecord(exif)) return null;
  const raw = exifValue(exif, ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime'], '{Exif}');
  if (typeof raw !== 'string') return null;
  const match = EXIF_DATE.exec(raw.trim());
  if (!match) return null;
  const part = (index: number) => Number(match[index]);
  const year = part(1);
  const month = part(2);
  const day = part(3);
  const hours = part(4);
  const minutes = part(5);
  const seconds = part(6);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) return null;
  if (seconds > 59 || year < 1970) return null;

  const wallClock = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  // "31/02" u otras fechas imposibles se desbordan al mes siguiente: se descartan.
  if (new Date(wallClock).getUTCDate() !== day) return null;

  const offsetRaw = exifValue(exif, ['OffsetTimeOriginal', 'OffsetTime'], '{Exif}');
  const offset = typeof offsetRaw === 'string' ? EXIF_OFFSET.exec(offsetRaw.trim()) : null;
  if (offset) {
    const sign = offset[1] === '-' ? -1 : 1;
    const offsetMinutes = sign * (Number(offset[2]) * 60 + Number(offset[3]));
    return new Date(wallClock - offsetMinutes * 60_000);
  }
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

/**
 * Datos de la marca según el origen de la foto:
 * - Cámara: hora actual y la posición actual del dispositivo (si se obtuvo).
 * - Galería: la fecha de la foto (EXIF) si existe, si no la actual; y la
 *   ubicación de la foto (EXIF) si existe. NUNCA la posición actual: la foto
 *   pudo tomarse en otro lugar, y sería un dato falso.
 */
export function resolveStampData(input: {
  source: 'camera' | 'library';
  now: Date;
  exif?: unknown;
  deviceLocation?: PhotoLocation | null;
}): PhotoStampData {
  if (input.source === 'camera') {
    return { takenAt: input.now.toISOString(), location: input.deviceLocation ?? null };
  }
  const exifDate = dateFromExif(input.exif);
  return {
    takenAt: (exifDate ?? input.now).toISOString(),
    location: locationFromExif(input.exif),
  };
}

// ── Medidas de la franja ─────────────────────────────────────────────────────

export interface StampLayout {
  fontSize: number;
  lineHeight: number;
  /** Margen interior de la franja (izquierda, derecha, arriba y abajo). */
  padding: number;
  bandHeight: number;
  /** Ancho disponible para cada línea de texto. */
  maxTextWidth: number;
}

/** Proporción del ancho de la imagen que ocupa la letra (1920 px → 42 px). */
export const STAMP_FONT_RATIO = 0.022;
export const STAMP_MIN_FONT = 12;
export const STAMP_MAX_FONT = 72;
/** La franja nunca tapa más de este porcentaje de la altura. */
export const STAMP_MAX_BAND_RATIO = 0.4;

/**
 * Medidas de la franja inferior. La letra se escala con el ancho de la imagen;
 * en imágenes muy apaisadas se reduce para que la franja no tape demasiado.
 */
export function stampLayout(width: number, height: number, lineCount: number): StampLayout {
  const lines = Math.max(1, lineCount);
  const bandFor = (font: number) => Math.round(font * 1.3) * lines + Math.round(font * 0.6) * 2;
  let fontSize = Math.round(
    Math.min(STAMP_MAX_FONT, Math.max(STAMP_MIN_FONT, width * STAMP_FONT_RATIO)),
  );
  while (fontSize > STAMP_MIN_FONT && bandFor(fontSize) > height * STAMP_MAX_BAND_RATIO) {
    fontSize -= 1;
  }
  const lineHeight = Math.round(fontSize * 1.3);
  const padding = Math.round(fontSize * 0.6);
  return {
    fontSize,
    lineHeight,
    padding,
    bandHeight: Math.min(height, lineHeight * lines + padding * 2),
    maxTextWidth: Math.max(1, width - padding * 2),
  };
}

/**
 * Recorta `text` para que quepa en `maxWidth` según `measure` (ancho en px),
 * añadiendo "…". Devuelve el texto completo si ya cabe.
 */
export function fitText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  // Búsqueda binaria del mayor prefijo que cabe con la elipsis.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('').trimEnd()}${ELLIPSIS}`;
    if (measure(candidate) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return low === 0 ? ELLIPSIS : `${characters.slice(0, low).join('').trimEnd()}${ELLIPSIS}`;
}

// ── Pie del visor ────────────────────────────────────────────────────────────

export interface StampDetails {
  /** "18/11/2026 14:35:07" (hora local). */
  dateTime: string;
  /** Coordenadas con precisión, o "Ubicación no disponible". */
  location: string;
}

/**
 * Datos de la marca de una foto guardada, para el pie del visor. `null` en
 * las fotos anteriores a la marca (sin `taken_at`).
 */
export function stampDetails(photo: {
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
}): StampDetails | null {
  if (!photo.takenAt) return null;
  const date = new Date(photo.takenAt);
  if (Number.isNaN(date.getTime())) return null;
  return {
    dateTime: formatStampDateTime(date),
    location: formatLocationLine(
      validLocation(photo.latitude, photo.longitude, photo.locationAccuracy),
    ),
  };
}
