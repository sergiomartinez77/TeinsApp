import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { Visit } from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';

import {
  loadVisitReportData,
  type ReportDatabase,
  type ReportPhotoReader,
} from './visit-report.data';
import { buildVisitReportHtml } from './visit-report.html';
import { deviceReportPhotoReader } from './visit-report.images';

/**
 * Informe PDF de una visita: se genera EN EL TELÉFONO (sin conexión) a partir
 * de la base local con expo-print y se comparte con la hoja del sistema
 * (WhatsApp, correo, Drive…) con expo-sharing.
 */

const log = scopedLogger('reports');

export const REPORT_MESSAGES = {
  generateFailed: 'No se pudo generar el PDF de la visita. Intenta nuevamente.',
  shareUnavailable: 'Este dispositivo no permite compartir archivos desde la app.',
  shareFailed: 'No se pudo abrir el menú para compartir el PDF.',
  shareDialogTitle: 'Compartir informe de la visita',
} as const;

/** Carpeta de los informes dentro de la caché (el sistema puede vaciarla). */
export const REPORTS_DIRECTORY = 'teins_reports';

/** Tamaño A4 en puntos (1/72 de pulgada), el que usa expo-print. */
export const A4_POINTS = { width: 595, height: 842 } as const;

/** Márgenes de página en puntos (iOS; en Android mandan los de `@page`). */
const PAGE_MARGINS = { top: 45, right: 40, bottom: 50, left: 40 } as const;

const MAX_NAME_LENGTH = 40;

const pad = (value: number) => String(value).padStart(2, '0');

/** Texto apto para un nombre de archivo: sin acentos ni símbolos, con `_`. */
export function sanitizeFileNamePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/_+$/g, '');
}

/**
 * "Visita_<cliente>_<AAAA-MM-DD>.pdf": cliente (o el título si no hay), y la
 * fecha local en que se finalizó, se inició o se creó la visita.
 */
export function reportFileName(
  visit: Pick<Visit, 'clientName' | 'title' | 'completedAt' | 'startedAt' | 'createdAt'>,
): string {
  const name =
    sanitizeFileNamePart(visit.clientName ?? '') || sanitizeFileNamePart(visit.title) || 'TEINS';
  const raw = visit.completedAt ?? visit.startedAt ?? visit.createdAt;
  const date = new Date(raw);
  const day = Number.isNaN(date.getTime())
    ? ''
    : `_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `Visita_${name}${day}.pdf`;
}

export interface VisitReportFile {
  /** URI local (`file://…`) del PDF, en la caché de la app. */
  readonly uri: string;
  readonly fileName: string;
  readonly pageCount: number;
}

export interface GenerateVisitReportOptions {
  /** Nombre a mostrar si el perfil del técnico no está en la base local. */
  technicianName?: string | null;
  /** Lector de fotos (por defecto, el del dispositivo). */
  photoReader?: ReportPhotoReader;
  now?: Date;
}

/** Mueve el PDF temporal de expo-print a `<caché>/teins_reports/<nombre>`. */
async function moveToReports(sourceUri: string, fileName: string): Promise<string> {
  const folder = new Directory(Paths.cache, REPORTS_DIRECTORY);
  folder.create({ intermediates: true, idempotent: true });
  const destination = new File(folder, fileName);
  await new File(sourceUri).move(destination, { overwrite: true });
  return destination.uri;
}

/**
 * Genera el PDF de una visita del técnico, sin conexión. Nunca lanza: los
 * errores vuelven en el `Result` con un mensaje apto para el usuario.
 */
export async function generateVisitReportPdf(
  db: ReportDatabase,
  technicianId: string,
  visitId: string,
  options: GenerateVisitReportOptions = {},
): Promise<Result<VisitReportFile>> {
  const data = await loadVisitReportData(db, {
    technicianId,
    visitId,
    photoReader: options.photoReader ?? deviceReportPhotoReader,
    fallbackTechnicianName: options.technicianName,
    now: options.now,
  });
  if (!data.ok) return data;

  try {
    const html = buildVisitReportHtml(data.data);
    const printed = await Print.printToFileAsync({
      html,
      width: A4_POINTS.width,
      height: A4_POINTS.height,
      margins: PAGE_MARGINS,
    });
    const fileName = reportFileName(data.data.visit);
    const uri = await moveToReports(printed.uri, fileName);
    return ok({ uri, fileName, pageCount: printed.numberOfPages });
  } catch (error) {
    log.error('No se pudo generar el PDF de la visita', error);
    return err(appError('storage', { message: REPORT_MESSAGES.generateFailed, cause: error }));
  }
}

/** Abre la hoja de compartir del sistema con el PDF. */
export async function shareVisitReport(uri: string): Promise<Result<void>> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return err(validationError(REPORT_MESSAGES.shareUnavailable, 'sharing_unavailable'));
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: REPORT_MESSAGES.shareDialogTitle,
    });
    return ok(undefined);
  } catch (error) {
    log.error('No se pudo compartir el PDF', error);
    return err(appError('unknown', { message: REPORT_MESSAGES.shareFailed, cause: error }));
  }
}
