import { File, Paths } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';

import { TEMPLATE_KEY } from '@/models/form.model';
import type { VisitPhoto } from '@/models/photo.model';
import {
  annotationRow,
  photoRow,
  responseRow,
  TECH_A,
  TECH_B,
  templateRow,
  visitMaterialRow,
  visitRow,
} from '@/test-utils/fixtures';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

import {
  DEFAULT_FIND_LIMIT,
  findVisitsForReport,
  loadVisitReportData,
  MAX_REPORT_PHOTOS,
  type ReportDatabase,
  type ReportPhotoReader,
} from '../services/visit-report.data';
import { deviceReportPhotoReader } from '../services/visit-report.images';

/**
 * Datos del informe contra SQLite real (base de test) y el sistema de
 * archivos en memoria de jest-expo. La reducción de las fotos con
 * expo-image-manipulator se simula: devuelve un JPEG falso en base64.
 */

jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const NOW = new Date('2026-06-02T10:00:00.000Z');

let db: TestDatabase;

/** Contexto falso de expo-image-manipulator. */
interface FakeContext {
  resize: jest.Mock;
  renderAsync: jest.Mock;
  release: jest.Mock;
}

/** Simula la API contextual de expo-image-manipulator (sin decodificar nada). */
function mockManipulator(base64: string | null = 'QUJD') {
  jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
    const context: FakeContext = {
      resize: jest.fn(() => context),
      renderAsync: jest.fn(async () => ({
        width: 640,
        height: 480,
        release: jest.fn(),
        saveAsync: jest.fn(async () => ({
          uri: `${Paths.cache.uri}reducida.jpg`,
          width: 640,
          height: 480,
          base64: base64 ?? undefined,
        })),
      })),
      release: jest.fn(),
    };
    return context as unknown as ReturnType<typeof ImageManipulator.manipulate>;
  });
}

const writePhotoFile = (relativePath: string) => {
  const folder = new File(Paths.document, relativePath).parentDirectory;
  folder.create({ intermediates: true, idempotent: true });
  new File(Paths.document, relativePath).write('jpeg');
};

beforeEach(() => {
  jest.clearAllMocks();
  db = createTestDatabase();
  mockManipulator();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function seedFullVisit() {
  db.insert('visits', [
    visitRow({
      id: 'v1',
      status: 'completed',
      client_name: 'Almacenes ABC',
      latitude: -3.99,
      longitude: -79.2,
      observations: 'Todo en orden',
    }),
    visitRow({ id: 'v-ajena', technician_id: TECH_B }),
  ]);
  db.insert('profiles', [
    {
      id: TECH_A,
      email: 'ana@teins.test',
      full_name: 'Ana Técnica',
      role: 'technician',
      phone: null,
      avatar_url: null,
    },
  ]);
  db.insert('form_templates', [templateRow({ id: 'tpl-db-1', name: 'Checklist de la base' })]);
  db.insert('form_responses', [
    responseRow({
      id: 'r1',
      template_id: 'tpl-db-1',
      template_key: 'tpl-db-1',
      responses: JSON.stringify({ f1: 'Cable dañado' }),
      is_complete: 1,
      completed_at: '2026-06-01T11:00:00.000Z',
      created_at: '2026-06-01T09:00:00.000Z',
    }),
    responseRow({
      id: 'r2',
      template_key: 'ups_cdp_v1',
      responses: JSON.stringify({ [TEMPLATE_KEY]: 'ups_cdp_v1' }),
      created_at: '2026-06-01T10:00:00.000Z',
    }),
  ]);
  db.insert('visit_materials', [
    visitMaterialRow({ id: 'vm1', quantity: 2.5, unit: 'metro' }),
    visitMaterialRow({
      id: 'vm2',
      material_id: null,
      is_custom: 1,
      material_code: '',
      material_name: 'Abrazadera especial',
      created_at: '2026-06-01T09:30:00.000Z',
    }),
  ]);
  db.insert('photos', [
    photoRow({
      id: 'p-local',
      local_path: 'teins_photos/p-local.jpg',
      captured_at: '2026-06-01T09:00:00.000Z',
    }),
    photoRow({
      id: 'p-sin-archivo',
      local_path: 'teins_photos/p-sin-archivo.jpg',
      captured_at: '2026-06-01T09:10:00.000Z',
      sync_status: 'uploaded',
    }),
  ]);
  db.insert('annotations', [annotationRow({ id: 'a1', title: 'Planta baja' })]);
  writePhotoFile('teins_photos/p-local.jpg');
}

describe('loadVisitReportData', () => {
  it('reúne la visita, el técnico, varios formularios, materiales, fotos y planos', async () => {
    seedFullVisit();

    const result = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'v1',
      photoReader: deviceReportPhotoReader,
      now: NOW,
    });

    if (!result.ok) throw new Error(result.error.message);
    const data = result.data;
    expect(data.visit.clientName).toBe('Almacenes ABC');
    expect(data.technicianName).toBe('Ana Técnica');
    expect(data.generatedAt).toBe(NOW);

    // Dos formularios: uno con plantilla de la base y otro con la de respaldo.
    expect(data.forms.map((form) => form.name)).toEqual([
      'Checklist de la base',
      'Informe Técnico UPS (CDP)',
    ]);
    expect(data.forms[0]?.isComplete).toBe(true);
    expect(data.forms[0]?.response.values).toEqual({ f1: 'Cable dañado' });
    expect(data.forms[1]?.template?.source).toBe('asset');

    // Materiales en el orden en que se agregaron, con el personalizado marcado.
    expect(data.materials.map((material) => [material.id, material.isCustom])).toEqual([
      ['vm1', false],
      ['vm2', true],
    ]);

    // Fotos en orden cronológico; la que no está en el dispositivo queda marcada.
    expect(data.photos.map((item) => [item.photo.id, item.image.status])).toEqual([
      ['p-local', 'embedded'],
      ['p-sin-archivo', 'missing'],
    ]);
    expect(data.photos[0]?.image).toEqual({
      status: 'embedded',
      dataUri: 'data:image/jpeg;base64,QUJD',
    });
    expect(data.omittedPhotoCount).toBe(0);

    expect(data.annotations.map((plan) => plan.title)).toEqual(['Planta baja']);
  });

  it('una foto que no se puede procesar queda marcada y no impide el informe', async () => {
    seedFullVisit();
    const reader: ReportPhotoReader = {
      read: async (photo: VisitPhoto) => {
        if (photo.id === 'p-local') throw new Error('decodificación');
        return null;
      },
    };

    const result = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'v1',
      photoReader: reader,
    });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.photos.map((item) => item.image.status)).toEqual(['error', 'missing']);
    expect(result.data.generatedAt).toBeInstanceOf(Date);
  });

  it('sin perfil local usa el nombre indicado y, si no hay, null', async () => {
    db.insert('visits', [visitRow({ id: 'v1' })]);
    const reader: ReportPhotoReader = { read: async () => null };

    const withName = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'v1',
      photoReader: reader,
      fallbackTechnicianName: 'Ana (sesión)',
    });
    const withoutName = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'v1',
      photoReader: reader,
    });

    expect(withName.ok && withName.data.technicianName).toBe('Ana (sesión)');
    expect(withoutName.ok && withoutName.data.technicianName).toBeNull();
    expect(withoutName.ok && withoutName.data.forms).toEqual([]);
  });

  it('con un perfil sin nombre muestra el correo', async () => {
    db.insert('visits', [visitRow({ id: 'v1' })]);
    db.insert('profiles', [{ id: TECH_A, email: 'ana@teins.test', full_name: null }]);

    const result = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'v1',
      photoReader: { read: async () => null },
    });

    expect(result.ok && result.data.technicianName).toBe('ana@teins.test');
  });

  it(`incluye como máximo ${MAX_REPORT_PHOTOS} fotos (las más recientes) y cuenta las omitidas`, async () => {
    db.insert('visits', [visitRow({ id: 'v1' })]);
    db.insert(
      'photos',
      Array.from({ length: MAX_REPORT_PHOTOS + 3 }, (_, index) =>
        photoRow({
          id: `p${String(index).padStart(2, '0')}`,
          captured_at: `2026-06-01T08:${String(index).padStart(2, '0')}:00.000Z`,
        }),
      ),
    );

    const result = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'v1',
      photoReader: { read: async () => null },
    });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.photos).toHaveLength(MAX_REPORT_PHOTOS);
    expect(result.data.photos[0]?.photo.id).toBe('p03');
    expect(result.data.omittedPhotoCount).toBe(3);
  });

  it('no da datos de una visita ajena o inexistente', async () => {
    seedFullVisit();
    const reader: ReportPhotoReader = { read: async () => null };

    const foreign = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'v-ajena',
      photoReader: reader,
    });
    const missing = await loadVisitReportData(db, {
      technicianId: TECH_A,
      visitId: 'no-existe',
      photoReader: reader,
    });

    expect(foreign).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'validation', code: 'not_found' }),
    });
    expect(missing.ok).toBe(false);
  });

  it('un fallo de la base devuelve un error de base de datos', async () => {
    const broken: ReportDatabase = {
      getAll: async () => {
        throw new Error('disco');
      },
      getOptional: async () => {
        throw new Error('disco');
      },
    };

    const result = await loadVisitReportData(broken, {
      technicianId: TECH_A,
      visitId: 'v1',
      photoReader: { read: async () => null },
    });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: 'database' }) });
  });
});

describe('findVisitsForReport', () => {
  beforeEach(() => {
    db.insert('visits', [
      visitRow({ id: 'v1', title: 'Revisión UPS', client_name: 'Almacenes ABC' }),
      visitRow({
        id: 'v2',
        title: 'Cableado',
        client_name: 'Clínica Sur',
        created_at: '2026-06-03T08:00:00.000Z',
      }),
      visitRow({ id: 'v3', technician_id: TECH_B, client_name: 'Almacenes ABC' }),
    ]);
  });

  it('busca por cliente o título solo entre las visitas del técnico', async () => {
    const byClient = await findVisitsForReport(db, { technicianId: TECH_A, search: 'almacenes' });
    const byTitle = await findVisitsForReport(db, { technicianId: TECH_A, search: 'Cableado' });

    expect(byClient.ok && byClient.data.map((visit) => visit.id)).toEqual(['v1']);
    expect(byTitle.ok && byTitle.data.map((visit) => visit.id)).toEqual(['v2']);
  });

  it(`sin texto devuelve las más recientes (por defecto ${DEFAULT_FIND_LIMIT}) con límite`, async () => {
    const all = await findVisitsForReport(db, { technicianId: TECH_A });
    const one = await findVisitsForReport(db, { technicianId: TECH_A, limit: 1 });

    expect(all.ok && all.data.map((visit) => visit.id)).toEqual(['v2', 'v1']);
    expect(one.ok && one.data.map((visit) => visit.id)).toEqual(['v2']);
  });

  it('un fallo de la base devuelve un error de base de datos', async () => {
    const result = await findVisitsForReport(
      {
        getAll: async () => {
          throw new Error('disco');
        },
      },
      { technicianId: TECH_A, search: 'x' },
    );
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: 'database' }) });
  });
});

describe('deviceReportPhotoReader', () => {
  const photo = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'p1',
      localPath: 'teins_photos/lector.jpg',
      width: 1920,
      height: 1080,
      ...overrides,
    }) as unknown as VisitPhoto;

  it('reduce las fotos grandes antes de incrustarlas', async () => {
    writePhotoFile('teins_photos/lector.jpg');

    await expect(deviceReportPhotoReader.read(photo())).resolves.toBe(
      'data:image/jpeg;base64,QUJD',
    );
    const context = jest.mocked(ImageManipulator.manipulate).mock.results[0]?.value as {
      resize: jest.Mock;
    };
    expect(context.resize).toHaveBeenCalledWith({ width: 1280, height: 720 });
  });

  it('sin tamaño guardado mide la imagen decodificada', async () => {
    writePhotoFile('teins_photos/lector.jpg');

    await deviceReportPhotoReader.read(photo({ width: null, height: null }));
    // 640 × 480 ya cabe: no se vuelve a decodificar.
    expect(ImageManipulator.manipulate).toHaveBeenCalledTimes(1);
  });

  it('sin tamaño guardado y demasiado grande, la vuelve a decodificar reducida', async () => {
    writePhotoFile('teins_photos/lector.jpg');
    let calls = 0;
    jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
      calls += 1;
      const size = calls === 1 ? { width: 4000, height: 3000 } : { width: 1280, height: 960 };
      const context: FakeContext = {
        resize: jest.fn(() => context),
        renderAsync: jest.fn(async () => ({
          ...size,
          release: jest.fn(),
          saveAsync: jest.fn(async () => ({
            uri: 'file:///mock/cache/x.jpg',
            ...size,
            base64: 'Wg==',
          })),
        })),
        release: jest.fn(),
      };
      return context as unknown as ReturnType<typeof ImageManipulator.manipulate>;
    });

    await expect(deviceReportPhotoReader.read(photo({ width: 0, height: 0 }))).resolves.toBe(
      'data:image/jpeg;base64,Wg==',
    );
    expect(calls).toBe(2);
  });

  it('null si no hay ruta o el archivo no está; lanza si no hay base64', async () => {
    await expect(deviceReportPhotoReader.read(photo({ localPath: '' }))).resolves.toBeNull();
    await expect(
      deviceReportPhotoReader.read(photo({ localPath: 'teins_photos/no-existe.jpg' })),
    ).resolves.toBeNull();

    writePhotoFile('teins_photos/lector.jpg');
    mockManipulator(null);
    await expect(deviceReportPhotoReader.read(photo())).rejects.toThrow('base64');
  });
});
