import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';

import { useAuthStore } from '@/store/auth.store';
import { TECH_A, visitRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

import { VisitReportButton, REPORT_BUTTON_LABELS } from '../components/VisitReportButton';
import { REPORT_ERROR_TITLE, useVisitReport } from '../hooks/useVisitReport';
import {
  findVisitsForReport,
  generateVisitReportPdf,
  REPORT_MESSAGES,
  shareVisitReport,
} from '../index';
import {
  A4_POINTS,
  REPORTS_DIRECTORY,
  reportFileName,
  sanitizeFileNamePart,
} from '../services/visit-report.service';

/**
 * Generación y envío del PDF con expo-print y expo-sharing simulados (ver
 * jest.setup.ts: el "PDF" es un archivo en memoria con el HTML). El aspecto
 * real del PDF y la hoja de compartir se prueban a mano
 * (docs/PRUEBAS_MANUALES.md).
 */

jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const noPhotos = { read: async () => null };

let db: TestDatabase;

beforeEach(() => {
  jest.clearAllMocks();
  db = createTestDatabase();
  db.insert('visits', [
    visitRow({
      id: 'v1',
      client_name: 'Clínica Ñandú / Sur',
      completed_at: null,
      started_at: null,
      created_at: '2026-06-01T15:00:00.000Z',
    }),
  ]);
});

describe('nombre del archivo', () => {
  it('quita acentos y símbolos', () => {
    expect(sanitizeFileNamePart('  Clínica Ñandú / Sur #2 ')).toBe('Clinica_Nandu_Sur_2');
    expect(sanitizeFileNamePart('***')).toBe('');
    expect(sanitizeFileNamePart('a'.repeat(60))).toHaveLength(40);
  });

  it('usa el cliente (o el título) y la fecha de la visita', () => {
    const base = {
      title: 'Revisión UPS',
      startedAt: null,
      completedAt: null,
      createdAt: new Date(2026, 5, 1, 10).toISOString(),
    };
    expect(reportFileName({ ...base, clientName: 'Almacenes ABC' })).toBe(
      'Visita_Almacenes_ABC_2026-06-01.pdf',
    );
    expect(reportFileName({ ...base, clientName: null })).toBe(
      'Visita_Revision_UPS_2026-06-01.pdf',
    );
    expect(
      reportFileName({
        ...base,
        clientName: '¿?',
        title: '',
        completedAt: new Date(2026, 6, 9, 10).toISOString(),
      }),
    ).toBe('Visita_TEINS_2026-07-09.pdf');
    expect(reportFileName({ ...base, clientName: 'X', createdAt: 'no es fecha' })).toBe(
      'Visita_X.pdf',
    );
  });
});

describe('generateVisitReportPdf', () => {
  it('genera el PDF en A4 y lo deja en la caché con un nombre descriptivo', async () => {
    const result = await generateVisitReportPdf(db, TECH_A, 'v1', {
      photoReader: noPhotos,
      technicianName: 'Ana',
    });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.fileName).toMatch(/^Visita_Clinica_Nandu_Sur_2026-06-0\d\.pdf$/);
    expect(result.data.uri).toBe(`${Paths.cache.uri}${REPORTS_DIRECTORY}/${result.data.fileName}`);
    expect(result.data.pageCount).toBe(1);

    expect(Print.printToFileAsync).toHaveBeenCalledWith(
      expect.objectContaining({ width: A4_POINTS.width, height: A4_POINTS.height }),
    );
    const html = new File(result.data.uri).textSync();
    expect(html).toContain('Clínica Ñandú / Sur');
    expect(html).toContain('<td>Ana</td>');
  });

  it('una visita ajena no genera nada', async () => {
    const result = await generateVisitReportPdf(db, 'otro-tecnico', 'v1', {
      photoReader: noPhotos,
    });
    expect(result.ok).toBe(false);
    expect(Print.printToFileAsync).not.toHaveBeenCalled();
  });

  it('si la impresión falla devuelve un mensaje para el usuario', async () => {
    jest.mocked(Print.printToFileAsync).mockRejectedValueOnce(new Error('WebView'));

    const result = await generateVisitReportPdf(db, TECH_A, 'v1', { photoReader: noPhotos });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: REPORT_MESSAGES.generateFailed }),
    });
  });

  it('findVisitsForReport se exporta para el asistente', async () => {
    const result = await findVisitsForReport(db, { technicianId: TECH_A, search: 'ñandú' });
    expect(result.ok && result.data.map((visit) => visit.id)).toEqual(['v1']);
  });
});

describe('shareVisitReport', () => {
  it('abre la hoja de compartir con el tipo PDF', async () => {
    await expect(shareVisitReport('file:///mock/cache/a.pdf')).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///mock/cache/a.pdf', {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: REPORT_MESSAGES.shareDialogTitle,
    });
  });

  it('avisa si el dispositivo no permite compartir', async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);

    const result = await shareVisitReport('file:///mock/cache/a.pdf');

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'sharing_unavailable',
        message: REPORT_MESSAGES.shareUnavailable,
      }),
    });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('si la hoja falla devuelve un mensaje para el usuario', async () => {
    jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('actividad'));
    const result = await shareVisitReport('file:///mock/cache/a.pdf');
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ message: REPORT_MESSAGES.shareFailed }),
    });
  });
});

describe('useVisitReport', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { gcTime: Infinity } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    setTestDatabase(db);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: TECH_A,
        email: 'ana@teins.test',
        role: 'technician',
        fullName: null,
        phone: null,
        avatarUrl: null,
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
    setTestDatabase(null);
    jest.restoreAllMocks();
  });

  it('genera y comparte el PDF', async () => {
    const { result } = await renderHook(() => useVisitReport('v1'), { wrapper });
    expect(result.current.step).toBeNull();

    await act(async () => result.current.shareReport());

    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      expect.stringContaining(`${REPORTS_DIRECTORY}/Visita_Clinica_Nandu_Sur_`),
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
    expect(result.current.file?.fileName).toMatch(/^Visita_Clinica_Nandu_Sur_/);
    expect(result.current.error).toBeNull();
    expect(result.current.isBusy).toBe(false);
    expect(result.current.step).toBeNull();
    // Sin nombre en la sesión ni perfil local, el informe usa el correo.
    const html = new File(result.current.file?.uri ?? '').textSync();
    expect(html).toContain('ana@teins.test');
  });

  it('muestra el error con una alerta y lo deja en el estado', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    const { result } = await renderHook(() => useVisitReport('v1'), { wrapper });

    await act(async () => result.current.shareReport());

    expect(alert).toHaveBeenCalledWith(REPORT_ERROR_TITLE, REPORT_MESSAGES.shareUnavailable);
    expect(result.current.error).toBe(REPORT_MESSAGES.shareUnavailable);
    expect(result.current.file).toBeNull();
  });
});

describe('VisitReportButton', () => {
  it('se puede pulsar cuando no está trabajando', async () => {
    const onPress = jest.fn();
    await render(<VisitReportButton onPress={onPress} step={null} />);

    const button = screen.getByRole('button', {
      name: 'Generar y compartir el informe PDF de la visita',
    });
    expect(screen.getByText(REPORT_BUTTON_LABELS.idle)).toBeOnTheScreen();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('queda inactivo y anuncia el paso mientras genera o comparte', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<VisitReportButton onPress={onPress} step="generating" />);

    const button = screen.getByRole('button', { name: REPORT_BUTTON_LABELS.generating });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();

    await rerender(<VisitReportButton onPress={onPress} step="sharing" />);
    expect(screen.getByRole('button', { name: REPORT_BUTTON_LABELS.sharing })).toBeDisabled();
  });
});
