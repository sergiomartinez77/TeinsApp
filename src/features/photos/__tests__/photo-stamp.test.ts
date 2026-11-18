import {
  buildStampLines,
  dateFromExif,
  ELLIPSIS,
  exifCoordinate,
  fitText,
  formatAccuracy,
  formatCoordinates,
  formatLocationLine,
  formatStampDateTime,
  locationFromExif,
  resolveStampData,
  STAMP_MAX_BAND_RATIO,
  STAMP_MESSAGES,
  stampDetails,
  stampLayout,
  validLocation,
} from '../services/photo-stamp';

const LOJA = { latitude: -3.993421, longitude: -79.204512, accuracy: 8 };

describe('textos de la marca', () => {
  it('fecha y hora local con el formato dd/mm/aaaa hh:mm:ss', () => {
    expect(formatStampDateTime(new Date(2026, 10, 18, 14, 35, 7))).toBe('18/11/2026 14:35:07');
    expect(formatStampDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe('02/01/2026 03:04:05');
  });

  it('coordenadas con 6 decimales y punto decimal', () => {
    expect(formatCoordinates(LOJA)).toBe('-3.993421, -79.204512');
    expect(formatCoordinates({ latitude: 4.6, longitude: -74.08 })).toBe('4.600000, -74.080000');
    expect(formatCoordinates({ latitude: -0.0000001, longitude: 10 })).toBe('0.000000, 10.000000');
  });

  it('precisión redondeada a metros (mínimo 1 m)', () => {
    expect(formatAccuracy(8.4)).toBe('±8 m');
    expect(formatAccuracy(0.2)).toBe('±1 m');
  });

  it('línea de ubicación con precisión, sin ella o "Ubicación no disponible"', () => {
    expect(formatLocationLine(LOJA)).toBe('-3.993421, -79.204512 ±8 m');
    expect(formatLocationLine({ ...LOJA, accuracy: null })).toBe('-3.993421, -79.204512');
    expect(formatLocationLine(null)).toBe(STAMP_MESSAGES.noLocation);
  });

  it('líneas: fecha, ubicación y título (con espacios normalizados)', () => {
    const takenAt = new Date(2026, 10, 18, 14, 35, 7).toISOString();
    expect(buildStampLines({ takenAt, location: LOJA }, '  Visita   Bodega 3 ')).toEqual([
      '18/11/2026 14:35:07',
      '-3.993421, -79.204512 ±8 m',
      'Visita Bodega 3',
    ]);
    expect(buildStampLines({ takenAt, location: null }, '   ')).toEqual([
      '18/11/2026 14:35:07',
      'Ubicación no disponible',
    ]);
  });
});

describe('validLocation', () => {
  it('acepta coordenadas válidas y descarta precisión negativa', () => {
    expect(validLocation(-3.99, -79.2, 5)).toEqual({
      latitude: -3.99,
      longitude: -79.2,
      accuracy: 5,
    });
    expect(validLocation(-3.99, -79.2, -1)).toEqual({
      latitude: -3.99,
      longitude: -79.2,
      accuracy: null,
    });
  });

  it('descarta fuera de rango, no numéricas y (0, 0) (ubicación borrada por privacidad)', () => {
    expect(validLocation(91, 0)).toBeNull();
    expect(validLocation(0, 181)).toBeNull();
    expect(validLocation('1', 2)).toBeNull();
    expect(validLocation(Number.NaN, 2)).toBeNull();
    expect(validLocation(0, 0)).toBeNull();
  });
});

describe('EXIF', () => {
  it('coordenadas: decimal con signo (Android), fracciones DMS, lista y referencia S/W', () => {
    expect(exifCoordinate(-3.5, 'S')).toBe(-3.5);
    expect(exifCoordinate(3.5, 'S')).toBe(-3.5);
    expect(exifCoordinate('79/1,12/1,1620/100', 'W')).toBeCloseTo(-79.2045, 4);
    expect(exifCoordinate([3, 30, 0], 'N')).toBe(3.5);
    expect(exifCoordinate([-3, 30, 0], '')).toBe(-3.5);
    expect(exifCoordinate('4.25', 'O')).toBe(-4.25);
    expect(exifCoordinate('1/0', 'N')).toBeNull();
    expect(exifCoordinate('x,1,2', 'N')).toBeNull();
    expect(exifCoordinate(undefined, 'N')).toBeNull();
    expect(exifCoordinate('', 'N')).toBeNull();
  });

  it('ubicación de Android (claves planas) con precisión', () => {
    expect(
      locationFromExif({
        GPSLatitude: -3.993421,
        GPSLongitude: -79.204512,
        GPSLatitudeRef: 'S',
        GPSLongitudeRef: 'W',
        GPSHPositioningError: '8/1',
      }),
    ).toEqual(LOJA);
  });

  it('ubicación de iOS (diccionario {GPS})', () => {
    expect(
      locationFromExif({
        '{GPS}': { Latitude: 3.993421, LatitudeRef: 'S', Longitude: 79.204512, LongitudeRef: 'W' },
      }),
    ).toEqual({ ...LOJA, accuracy: null });
  });

  it('sin GPS, con (0, 0) o sin EXIF: null', () => {
    expect(locationFromExif({ Make: 'x' })).toBeNull();
    expect(locationFromExif({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
    expect(locationFromExif(null)).toBeNull();
    expect(locationFromExif([1, 2])).toBeNull();
  });

  it('fecha sin zona: hora local del dispositivo', () => {
    expect(dateFromExif({ DateTimeOriginal: '2026:11:18 14:35:07' })).toEqual(
      new Date(2026, 10, 18, 14, 35, 7),
    );
    expect(dateFromExif({ '{Exif}': { DateTimeOriginal: '2026:11:18 14:35:07' } })).toEqual(
      new Date(2026, 10, 18, 14, 35, 7),
    );
    expect(dateFromExif({ DateTime: '2026:11:18 14:35:07' })).toEqual(
      new Date(2026, 10, 18, 14, 35, 7),
    );
  });

  it('fecha con zona (OffsetTimeOriginal)', () => {
    expect(
      dateFromExif({ DateTimeOriginal: '2026:11:18 14:35:07', OffsetTimeOriginal: '-05:00' }),
    ).toEqual(new Date('2026-11-18T19:35:07.000Z'));
    expect(
      dateFromExif({ DateTimeOriginal: '2026:11:18 14:35:07', OffsetTimeOriginal: '+0100' }),
    ).toEqual(new Date('2026-11-18T13:35:07.000Z'));
  });

  it('fechas inválidas o imposibles: null', () => {
    expect(dateFromExif({ DateTimeOriginal: '2026:02:31 10:00:00' })).toBeNull();
    expect(dateFromExif({ DateTimeOriginal: '2026:13:01 10:00:00' })).toBeNull();
    expect(dateFromExif({ DateTimeOriginal: '2026:01:01 10:00:61' })).toBeNull();
    expect(dateFromExif({ DateTimeOriginal: '1960:01:01 10:00:00' })).toBeNull();
    expect(dateFromExif({ DateTimeOriginal: 'ayer' })).toBeNull();
    expect(dateFromExif({ DateTimeOriginal: 5 })).toBeNull();
    expect(dateFromExif(undefined)).toBeNull();
  });
});

describe('resolveStampData (de dónde sale cada dato)', () => {
  const now = new Date('2026-11-18T19:35:07.000Z');

  it('cámara: hora actual y posición del dispositivo', () => {
    expect(resolveStampData({ source: 'camera', now, deviceLocation: LOJA })).toEqual({
      takenAt: now.toISOString(),
      location: LOJA,
    });
    expect(resolveStampData({ source: 'camera', now })).toEqual({
      takenAt: now.toISOString(),
      location: null,
    });
  });

  it('galería con EXIF: fecha y ubicación de la foto', () => {
    const exif = {
      DateTimeOriginal: '2026:10:01 08:00:00',
      OffsetTimeOriginal: '-05:00',
      GPSLatitude: -3.993421,
      GPSLongitude: -79.204512,
    };
    expect(resolveStampData({ source: 'library', now, exif, deviceLocation: LOJA })).toEqual({
      takenAt: '2026-10-01T13:00:00.000Z',
      location: { ...LOJA, accuracy: null },
    });
  });

  it('galería sin EXIF: fecha actual y SIN ubicación (nunca la posición actual)', () => {
    expect(resolveStampData({ source: 'library', now, exif: null, deviceLocation: LOJA })).toEqual({
      takenAt: now.toISOString(),
      location: null,
    });
  });
});

describe('medidas y recorte', () => {
  it('la letra se escala con el ancho', () => {
    expect(stampLayout(1920, 1080, 3).fontSize).toBe(42);
    expect(stampLayout(1080, 1920, 3).fontSize).toBe(24);
    expect(stampLayout(100, 1000, 3).fontSize).toBe(12);
  });

  it('la franja no supera el 40 % de la altura en imágenes muy apaisadas', () => {
    const layout = stampLayout(1920, 200, 3);
    expect(layout.bandHeight).toBeLessThanOrEqual(200 * STAMP_MAX_BAND_RATIO);
    expect(layout.maxTextWidth).toBe(1920 - layout.padding * 2);
  });

  const measure = (text: string) => Array.from(text).length * 10;

  it('fitText deja el texto si cabe y recorta con elipsis si no', () => {
    expect(fitText('Visita corta', 200, measure)).toBe('Visita corta');
    const fitted = fitText('Mantenimiento preventivo de la UPS principal', 100, measure);
    expect(fitted.endsWith(ELLIPSIS)).toBe(true);
    expect(measure(fitted)).toBeLessThanOrEqual(100);
    expect(fitText('abc', 5, measure)).toBe(ELLIPSIS);
  });
});

describe('stampDetails (pie del visor)', () => {
  it('foto con marca y ubicación', () => {
    const takenAt = new Date(2026, 10, 18, 14, 35, 7).toISOString();
    expect(
      stampDetails({ takenAt, latitude: -3.993421, longitude: -79.204512, locationAccuracy: 8 }),
    ).toEqual({ dateTime: '18/11/2026 14:35:07', location: '-3.993421, -79.204512 ±8 m' });
  });

  it('foto con marca sin ubicación', () => {
    expect(
      stampDetails({
        takenAt: new Date(2026, 0, 1).toISOString(),
        latitude: null,
        longitude: null,
        locationAccuracy: null,
      })?.location,
    ).toBe('Ubicación no disponible');
  });

  it('foto anterior a la marca o fecha inválida: null', () => {
    const empty = { latitude: null, longitude: null, locationAccuracy: null };
    expect(stampDetails({ takenAt: null, ...empty })).toBeNull();
    expect(stampDetails({ takenAt: 'no-es-fecha', ...empty })).toBeNull();
  });
});
