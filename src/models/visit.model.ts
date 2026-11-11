import type { IconName } from '@/components/ui/Icon';
import { colors } from '@/theme';
import { validationError, type AppError } from '@/types/errors';

// ── Estado de negocio ────────────────────────────────────────────────────────

/** Estado de negocio de la visita. Independiente del estado de sincronización. */
export type VisitStatus = 'assigned' | 'inProgress' | 'completed' | 'pendingReview' | 'synced';

const VISIT_STATUSES: readonly VisitStatus[] = [
  'assigned',
  'inProgress',
  'completed',
  'pendingReview',
  'synced',
];

/** Máquina de estados: assigned → inProgress → completed → pendingReview → synced */
export const VISIT_TRANSITIONS: Readonly<Record<VisitStatus, readonly VisitStatus[]>> = {
  assigned: ['inProgress'],
  inProgress: ['completed'],
  completed: ['pendingReview', 'synced'],
  pendingReview: ['synced'],
  synced: [],
};

export function parseVisitStatus(value: unknown): VisitStatus {
  return VISIT_STATUSES.find((status) => status === value) ?? 'assigned';
}

export function canTransitionTo(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from].includes(to);
}

export const VISIT_STATUS_LABELS: Readonly<Record<VisitStatus, string>> = {
  assigned: 'Asignada',
  inProgress: 'En progreso',
  completed: 'Completada',
  pendingReview: 'En revisión',
  synced: 'Sincronizada',
};

export const VISIT_STATUS_COLORS: Readonly<Record<VisitStatus, string>> = {
  assigned: colors.visitAssigned,
  inProgress: colors.visitInProgress,
  completed: colors.visitCompleted,
  pendingReview: colors.visitCompleted,
  synced: colors.visitSynced,
};

/** Estados que cuentan como "completadas" en filtros y estadísticas. */
export const FINISHED_STATUSES: readonly VisitStatus[] = ['completed', 'pendingReview', 'synced'];

// ── Estado de sincronización de un registro ──────────────────────────────────

export type RecordSyncStatus =
  'local' | 'pendingSync' | 'syncing' | 'synced' | 'syncError' | 'conflict';

const RECORD_SYNC_STATUSES: readonly RecordSyncStatus[] = [
  'local',
  'pendingSync',
  'syncing',
  'synced',
  'syncError',
  'conflict',
];

export function parseRecordSyncStatus(value: unknown): RecordSyncStatus {
  return RECORD_SYNC_STATUSES.find((status) => status === value) ?? 'local';
}

/** Estados en los que el registro todavía no está confirmado en el servidor. */
export const UNSYNCED_STATUSES: readonly RecordSyncStatus[] = ['local', 'pendingSync', 'syncError'];

export interface RecordSyncInfo {
  label: string;
  color: string;
  icon: IconName;
}

export const RECORD_SYNC_INFO: Readonly<Record<RecordSyncStatus, RecordSyncInfo>> = {
  local: { label: 'En el dispositivo', color: colors.pendingSync, icon: 'smartphone' },
  pendingSync: { label: 'Por sincronizar', color: colors.pendingSync, icon: 'cloud-upload' },
  syncing: { label: 'Sincronizando', color: colors.syncing, icon: 'sync' },
  synced: { label: 'Sincronizada', color: colors.online, icon: 'cloud-done' },
  syncError: { label: 'Error al sincronizar', color: colors.error, icon: 'sync-problem' },
  conflict: { label: 'En conflicto', color: colors.error, icon: 'warning' },
};

// ── Tipos de visita ──────────────────────────────────────────────────────────

export const VISIT_TYPES = ['general', 'ups', 'infraestructura', 'energia', 'datos'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_TYPE_LABELS: Readonly<Record<VisitType, string>> = {
  general: 'Visita Técnica TEINS',
  ups: 'Informe Técnico UPS (CDP)',
  infraestructura: 'Inspección de Infraestructura',
  energia: 'Inspección de Energía',
  datos: 'Inspección de Datos / Red',
};

/** Nombre legible del tipo; si el servidor envía uno desconocido se muestra tal cual. */
export function visitTypeLabel(type: string): string {
  return VISIT_TYPE_LABELS[type as VisitType] ?? type;
}

// ── Entidad ──────────────────────────────────────────────────────────────────

/** Visita técnica. Las fechas son texto ISO 8601 en UTC. */
export interface Visit {
  readonly id: string;
  readonly technicianId: string;
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly visitType: string;
  readonly address: string | null;
  readonly status: VisitStatus;
  readonly syncStatus: RecordSyncStatus;
  readonly formTemplateId: string | null;
  readonly formTemplateVersion: number | null;
  readonly observations: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const numeric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Convierte una fila de SQLite en una visita. */
export function visitFromRow(row: Record<string, unknown>): Visit {
  return {
    id: String(row.id),
    technicianId: text(row.technician_id) ?? '',
    clientId: text(row.client_id),
    clientName: text(row.client_name),
    title: text(row.title) ?? '',
    description: text(row.description),
    visitType: text(row.visit_type) ?? 'general',
    address: text(row.address),
    status: parseVisitStatus(row.status),
    syncStatus: parseRecordSyncStatus(row.sync_status),
    formTemplateId: text(row.form_template_id),
    formTemplateVersion: numeric(row.form_template_version),
    observations: text(row.observations),
    createdAt: text(row.created_at) ?? '',
    updatedAt: text(row.updated_at),
    startedAt: text(row.started_at),
    completedAt: text(row.completed_at),
    latitude: numeric(row.latitude),
    longitude: numeric(row.longitude),
  };
}

/** Una visita se puede editar mientras está asignada o en progreso. */
export function isEditable(visit: Pick<Visit, 'status'>): boolean {
  return visit.status === 'assigned' || visit.status === 'inProgress';
}

export function hasPendingSync(visit: Pick<Visit, 'syncStatus'>): boolean {
  return UNSYNCED_STATUSES.includes(visit.syncStatus);
}

/** Cambios que produce una transición de estado válida. */
export interface VisitTransition {
  status: VisitStatus;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  syncStatus: RecordSyncStatus;
}

export type TransitionResult = { ok: true; data: VisitTransition } | { ok: false; error: AppError };

/**
 * Aplica la máquina de estados.
 * - Al iniciar: registra `startedAt` (sin sobrescribir uno existente).
 * - Al completar: registra `completedAt`.
 * - Siempre: marca el registro como pendiente de sincronizar.
 * Una transición no permitida devuelve un error; nunca se aplica.
 */
export function transitionVisit(
  visit: Pick<Visit, 'status' | 'startedAt' | 'completedAt'>,
  next: VisitStatus,
  now: Date = new Date(),
): TransitionResult {
  if (!canTransitionTo(visit.status, next)) {
    return {
      ok: false,
      error: validationError(
        `Una visita ${VISIT_STATUS_LABELS[visit.status].toLowerCase()} no puede pasar a ${VISIT_STATUS_LABELS[next].toLowerCase()}.`,
        'invalid_transition',
      ),
    };
  }

  const timestamp = now.toISOString();
  return {
    ok: true,
    data: {
      status: next,
      startedAt: next === 'inProgress' ? (visit.startedAt ?? timestamp) : visit.startedAt,
      completedAt: next === 'completed' ? timestamp : visit.completedAt,
      updatedAt: timestamp,
      syncStatus: 'pendingSync',
    },
  };
}
