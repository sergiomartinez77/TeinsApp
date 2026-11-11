import {
  canTransitionTo,
  hasPendingSync,
  isEditable,
  parseRecordSyncStatus,
  parseVisitStatus,
  transitionVisit,
  VISIT_TRANSITIONS,
  VISIT_TYPE_LABELS,
  VISIT_TYPES,
  visitFromRow,
  visitTypeLabel,
  type VisitStatus,
} from '../visit.model';

const STATUSES: VisitStatus[] = ['assigned', 'inProgress', 'completed', 'pendingReview', 'synced'];
const NOW = new Date('2026-04-02T15:30:00.000Z');

describe('máquina de estados de la visita', () => {
  it('solo permite las transiciones definidas', () => {
    const allowed = new Set([
      'assigned>inProgress',
      'inProgress>completed',
      'completed>pendingReview',
      'completed>synced',
      'pendingReview>synced',
    ]);

    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(canTransitionTo(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
    expect(VISIT_TRANSITIONS.synced).toEqual([]);
  });

  it('al iniciar registra la hora de inicio y marca pendiente de sincronizar', () => {
    const result = transitionVisit(
      { status: 'assigned', startedAt: null, completedAt: null },
      'inProgress',
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        status: 'inProgress',
        startedAt: '2026-04-02T15:30:00.000Z',
        completedAt: null,
        updatedAt: '2026-04-02T15:30:00.000Z',
        syncStatus: 'pendingSync',
      },
    });
  });

  it('no sobrescribe una hora de inicio existente', () => {
    const result = transitionVisit(
      { status: 'assigned', startedAt: '2026-04-01T08:00:00.000Z', completedAt: null },
      'inProgress',
      NOW,
    );

    expect(result.ok && result.data.startedAt).toBe('2026-04-01T08:00:00.000Z');
  });

  it('al completar registra la hora de finalización y conserva la de inicio', () => {
    const result = transitionVisit(
      { status: 'inProgress', startedAt: '2026-04-02T09:00:00.000Z', completedAt: null },
      'completed',
      NOW,
    );

    expect(result.ok && result.data).toMatchObject({
      status: 'completed',
      startedAt: '2026-04-02T09:00:00.000Z',
      completedAt: '2026-04-02T15:30:00.000Z',
    });
  });

  it('rechaza una transición inválida con un mensaje claro', () => {
    const result = transitionVisit(
      { status: 'assigned', startedAt: null, completedAt: null },
      'completed',
      NOW,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'validation',
        code: 'invalid_transition',
        message: 'Una visita asignada no puede pasar a completada.',
      },
    });
  });

  it('una visita sincronizada es un estado final', () => {
    for (const to of STATUSES) {
      expect(transitionVisit({ status: 'synced', startedAt: null, completedAt: null }, to).ok).toBe(
        false,
      );
    }
  });
});

describe('reglas de la visita', () => {
  it('solo se edita mientras está asignada o en progreso', () => {
    expect(isEditable({ status: 'assigned' })).toBe(true);
    expect(isEditable({ status: 'inProgress' })).toBe(true);
    expect(isEditable({ status: 'completed' })).toBe(false);
    expect(isEditable({ status: 'synced' })).toBe(false);
  });

  it('detecta los registros sin confirmar en el servidor', () => {
    expect(hasPendingSync({ syncStatus: 'local' })).toBe(true);
    expect(hasPendingSync({ syncStatus: 'pendingSync' })).toBe(true);
    expect(hasPendingSync({ syncStatus: 'syncError' })).toBe(true);
    expect(hasPendingSync({ syncStatus: 'synced' })).toBe(false);
  });

  it('usa valores seguros ante estados desconocidos', () => {
    expect(parseVisitStatus('cancelada')).toBe('assigned');
    expect(parseRecordSyncStatus(null)).toBe('local');
  });

  it('tiene etiqueta para los cinco tipos de visita', () => {
    expect(VISIT_TYPES).toEqual(['general', 'ups', 'infraestructura', 'energia', 'datos']);
    for (const type of VISIT_TYPES) expect(VISIT_TYPE_LABELS[type].length).toBeGreaterThan(0);
    expect(visitTypeLabel('energia')).toBe('Inspección de Energía');
    expect(visitTypeLabel('tipo-nuevo')).toBe('tipo-nuevo');
  });
});

describe('visitFromRow', () => {
  it('convierte una fila de SQLite completa', () => {
    const visit = visitFromRow({
      id: 'v1',
      technician_id: 't1',
      client_id: null,
      client_name: 'Almacenes ABC',
      title: 'VT-00001',
      description: 'Revisión',
      visit_type: 'infraestructura',
      address: 'Calle 1',
      status: 'inProgress',
      sync_status: 'pendingSync',
      form_template_id: 'tpl',
      form_template_version: 1,
      observations: null,
      created_at: '2026-04-01T08:00:00.000Z',
      updated_at: '2026-04-01T09:00:00.000Z',
      started_at: '2026-04-01T09:00:00.000Z',
      completed_at: null,
      latitude: -3.99,
      longitude: -79.2,
    });

    expect(visit).toEqual({
      id: 'v1',
      technicianId: 't1',
      clientId: null,
      clientName: 'Almacenes ABC',
      title: 'VT-00001',
      description: 'Revisión',
      visitType: 'infraestructura',
      address: 'Calle 1',
      status: 'inProgress',
      syncStatus: 'pendingSync',
      formTemplateId: 'tpl',
      formTemplateVersion: 1,
      observations: null,
      createdAt: '2026-04-01T08:00:00.000Z',
      updatedAt: '2026-04-01T09:00:00.000Z',
      startedAt: '2026-04-01T09:00:00.000Z',
      completedAt: null,
      latitude: -3.99,
      longitude: -79.2,
    });
  });

  it('tolera una fila con datos faltantes', () => {
    const visit = visitFromRow({ id: 'v2' });

    expect(visit).toMatchObject({
      id: 'v2',
      title: '',
      visitType: 'general',
      status: 'assigned',
      syncStatus: 'local',
      latitude: null,
    });
  });
});
