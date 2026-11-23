import { ANNOTATIONS_BY_VISIT_SQL } from '@/features/annotations/services/annotation.queries';
import { VISIT_MATERIALS_SQL } from '@/features/materials/services/material.queries';
import { VISIT_PHOTO_COUNT_SQL, VISIT_PHOTOS_SQL } from '@/features/photos/services/photo.queries';
import { VISIT_RESPONSES_SQL } from '@/features/forms/services/response.service';
import { buildTemplateCatalog, TEMPLATES_SQL } from '@/features/forms/services/template.service';
import { buildVisitForms, type VisitFormItem } from '@/features/forms/services/visit-forms';
import { buildVisitByIdQuery, buildVisitListQuery } from '@/features/visits/services/visit.queries';
import { VISIT_MESSAGES } from '@/features/visits/services/visit.service';
import { annotationFromRow, type VisitAnnotation } from '@/models/annotation.model';
import { responseFromRow } from '@/models/form.model';
import { visitMaterialFromRow, type VisitMaterial } from '@/models/material.model';
import { photoFromRow, type VisitPhoto } from '@/models/photo.model';
import { profileFromRow } from '@/models/user.model';
import { visitFromRow, type Visit } from '@/models/visit.model';
import { appError, err, ok, validationError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';

/**
 * Datos del informe PDF de una visita, leídos de la base LOCAL (funciona sin
 * conexión). Reutiliza las consultas y conversiones de cada sección: aquí no
 * se repite SQL que ya exista.
 */

const log = scopedLogger('reports');

type Row = Record<string, unknown>;

/** Lecturas que necesita el informe (subconjunto de PowerSync). */
export interface ReportDatabase {
  getAll: <T>(sql: string, parameters?: unknown[]) => Promise<T[]>;
  getOptional: <T>(sql: string, parameters?: unknown[]) => Promise<T | null>;
}

/**
 * Lee la foto del dispositivo y la devuelve reducida como data URI
 * (`data:image/jpeg;base64,…`). `null` si el archivo ya no está en el
 * dispositivo. Lanza si el archivo existe pero no se puede procesar.
 */
export interface ReportPhotoReader {
  read: (photo: VisitPhoto) => Promise<string | null>;
}

/** Máximo de fotografías incluidas en el PDF (para que el archivo no se dispare). */
export const MAX_REPORT_PHOTOS = 40;

/** Perfil del técnico de la visita (nombre para el informe). */
export const PROFILE_BY_ID_SQL = 'SELECT * FROM profiles WHERE id = ? LIMIT 1';

/** Imagen de una foto en el informe. */
export type ReportPhotoImage =
  | { readonly status: 'embedded'; readonly dataUri: string }
  /** El archivo no está en el dispositivo (p. ej. se liberó tras subirse). */
  | { readonly status: 'missing' }
  /** El archivo existe pero no se pudo leer o reducir. */
  | { readonly status: 'error' };

export interface ReportPhoto {
  readonly photo: VisitPhoto;
  readonly image: ReportPhotoImage;
}

export interface VisitReportData {
  readonly visit: Visit;
  /** Nombre (o correo) del técnico; `null` si no se conoce. */
  readonly technicianName: string | null;
  /** Formularios de la visita, en el orden en que se empezaron, con su plantilla. */
  readonly forms: readonly VisitFormItem[];
  readonly materials: readonly VisitMaterial[];
  /** Fotografías incluidas, de la más antigua a la más reciente. */
  readonly photos: readonly ReportPhoto[];
  /** Fotografías de la visita que no caben en el informe (las más antiguas). */
  readonly omittedPhotoCount: number;
  readonly annotations: readonly VisitAnnotation[];
  readonly generatedAt: Date;
}

export interface LoadVisitReportOptions {
  /**
   * Alcance: id del técnico (solo sus visitas) o `null` (cualquier visita del
   * teléfono: admin y oficina, que las reciben todas). Ver `visitScopeFor`.
   */
  technicianId: string | null;
  visitId: string;
  photoReader: ReportPhotoReader;
  /**
   * Nombre a mostrar si el perfil del técnico no está en la base local. Solo
   * se usa si la visita es de `currentUserId` (el usuario que pide el PDF).
   */
  fallbackTechnicianName?: string | null;
  /** Usuario que pide el informe (por defecto, `technicianId`). */
  currentUserId?: string;
  now?: Date;
}

async function readPhoto(reader: ReportPhotoReader, photo: VisitPhoto): Promise<ReportPhoto> {
  try {
    const dataUri = await reader.read(photo);
    return { photo, image: dataUri ? { status: 'embedded', dataUri } : { status: 'missing' } };
  } catch (error) {
    log.warn('No se pudo preparar una foto para el informe', { photoId: photo.id, error });
    return { photo, image: { status: 'error' } };
  }
}

/**
 * Reúne todo lo que va en el informe de una visita (del técnico o, para admin
 * y oficina, de cualquier técnico). Nunca lanza:
 * una visita ajena o inexistente da un error de validación y un fallo de la
 * base, un error `database`. Una foto que no se puede leer no impide el
 * informe: queda marcada para mostrar un aviso en su lugar.
 */
export async function loadVisitReportData(
  db: ReportDatabase,
  options: LoadVisitReportOptions,
): Promise<Result<VisitReportData>> {
  const { technicianId, visitId } = options;
  try {
    const visitQuery = buildVisitByIdQuery(visitId, technicianId);
    const visitRow = await db.getOptional<Row>(visitQuery.sql, visitQuery.parameters);
    if (!visitRow) return err(validationError(VISIT_MESSAGES.notFound, 'not_found'));
    const visit = visitFromRow(visitRow);
    const requester = options.currentUserId ?? technicianId;

    const [profileRow, templateRows, responseRows, materialRows, photoRows, countRow, planRows] =
      await Promise.all([
        // El técnico de la visita (no quien pide el PDF).
        db.getOptional<Row>(PROFILE_BY_ID_SQL, [visit.technicianId]),
        db.getAll<Row>(TEMPLATES_SQL),
        db.getAll<Row>(VISIT_RESPONSES_SQL, [visitId]),
        db.getAll<Row>(VISIT_MATERIALS_SQL, [visitId]),
        db.getAll<Row>(VISIT_PHOTOS_SQL, [visitId, MAX_REPORT_PHOTOS]),
        db.getOptional<Row>(VISIT_PHOTO_COUNT_SQL, [visitId]),
        db.getAll<Row>(ANNOTATIONS_BY_VISIT_SQL, [visitId]),
      ]);

    const profile = profileRow ? profileFromRow(profileRow) : null;
    const fallback = visit.technicianId === requester ? options.fallbackTechnicianName : null;
    const technicianName =
      profile?.fullName ?? fallback ?? (profile?.email || visit.technicianName || null);

    const forms = buildVisitForms(
      responseRows.map(responseFromRow),
      buildTemplateCatalog(templateRows),
      visit.visitType,
    );

    // La consulta de fotos devuelve las más recientes primero; el informe las
    // muestra en orden cronológico. Se leen de una en una para no tener
    // varias imágenes decodificadas en memoria a la vez.
    const recent = photoRows.map(photoFromRow).reverse();
    const photos: ReportPhoto[] = [];
    for (const photo of recent) {
      photos.push(await readPhoto(options.photoReader, photo));
    }
    const total = Number(countRow?.count ?? photos.length);

    return ok({
      visit,
      technicianName,
      forms,
      materials: materialRows.map(visitMaterialFromRow),
      photos,
      omittedPhotoCount: Math.max(0, (Number.isFinite(total) ? total : 0) - photos.length),
      annotations: planRows.map(annotationFromRow),
      generatedAt: options.now ?? new Date(),
    });
  } catch (error) {
    log.error('No se pudieron leer los datos del informe', error);
    return err(appError('database', { cause: error }));
  }
}

// ── Búsqueda de visitas (para el asistente) ──────────────────────────────────

export interface FindVisitsForReportOptions {
  /** Id del técnico (sus visitas) o `null` (todas las del teléfono: admin y oficina). */
  technicianId: string | null;
  /** Texto libre: título, cliente, dirección o tipo de visita. */
  search?: string;
  /** Máximo de visitas (por defecto 10). */
  limit?: number;
}

export const DEFAULT_FIND_LIMIT = 10;

/**
 * Visitas del técnico que coinciden con el texto, de la más reciente a la más
 * antigua (misma búsqueda que el listado de visitas). Para que el asistente
 * encuentre la visita de la que se pide el informe.
 */
export async function findVisitsForReport(
  db: Pick<ReportDatabase, 'getAll'>,
  options: FindVisitsForReportOptions,
): Promise<Result<Visit[]>> {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_FIND_LIMIT));
  const query = buildVisitListQuery(options.technicianId, {
    filter: 'all',
    search: options.search ?? '',
    limit,
  });
  try {
    const rows = await db.getAll<Row>(query.sql, query.parameters);
    return ok(rows.map(visitFromRow));
  } catch (error) {
    log.error('No se pudieron buscar visitas para el informe', error);
    return err(appError('database', { cause: error }));
  }
}
