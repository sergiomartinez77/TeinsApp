import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  EMPTY_VISIT_STATS,
  IN_PROGRESS_VISITS_SQL,
  VISIT_STATS_SQL,
  visitStatsFromRow,
} from '@/features/visits/services/visit.queries';
import { visitFromRow } from '@/models/visit.model';
import { useSyncStore } from '@/store/sync.store';

import { InProgressSection } from '../components/InProgressSection';
import { QuickActions } from '../components/QuickActions';
import { buildStatItems, StatsRow } from '../components/StatsRow';
import { SyncStatusCard } from '../components/SyncStatusCard';
import { WelcomeHeader } from '../components/WelcomeHeader';

describe('consultas del dashboard', () => {
  it('filtran siempre por técnico', () => {
    expect(VISIT_STATS_SQL).toMatch(/WHERE technician_id = \?/);
    expect(IN_PROGRESS_VISITS_SQL).toMatch(/technician_id = \? AND status = 'inProgress'/);
    expect(IN_PROGRESS_VISITS_SQL).toMatch(/LIMIT \?/);
  });

  it('cuentan como completadas las visitas completadas, en revisión y sincronizadas', () => {
    expect(VISIT_STATS_SQL).toContain("status IN ('completed', 'pendingReview', 'synced')");
    expect(VISIT_STATS_SQL).toContain("sync_status IN ('local', 'pendingSync', 'syncError')");
  });

  it('convierte la fila de conteos y tolera que no haya datos', () => {
    expect(
      visitStatsFromRow({ assigned: 2, in_progress: 1, completed: 5, pending_sync: 3 }),
    ).toEqual({ assigned: 2, inProgress: 1, completed: 5, pendingSync: 3 });
    expect(visitStatsFromRow(undefined)).toEqual(EMPTY_VISIT_STATS);
  });
});

describe('WelcomeHeader', () => {
  it('saluda por el nombre y muestra la fecha con mayúscula inicial', async () => {
    await render(<WelcomeHeader name="Carlos" now={new Date(2026, 10, 11, 9)} />);

    expect(screen.getByRole('header', { name: 'Buenos días, Carlos' })).toBeOnTheScreen();
    expect(screen.getByText('Miércoles, 11 de noviembre de 2026')).toBeOnTheScreen();
  });
});

describe('StatsRow', () => {
  it('muestra los tres conteos y oculta "por sincronizar" si es cero', async () => {
    await render(<StatsRow stats={{ assigned: 4, inProgress: 1, completed: 9, pendingSync: 0 }} />);

    expect(screen.getByLabelText('Asignadas: 4')).toBeOnTheScreen();
    expect(screen.getByLabelText('En progreso: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Completadas: 9')).toBeOnTheScreen();
    expect(screen.queryByTestId('stat-pendingSync')).toBeNull();
  });

  it('añade "por sincronizar" cuando hay visitas pendientes', () => {
    const items = buildStatItems({ assigned: 0, inProgress: 0, completed: 0, pendingSync: 2 });
    expect(items.map((item) => item.key)).toEqual([
      'assigned',
      'inProgress',
      'completed',
      'pendingSync',
    ]);
  });
});

describe('InProgressSection', () => {
  const visit = visitFromRow({
    id: 'v1',
    title: 'VT-00002 — Inspección Energía',
    client_name: 'Industrias XYZ',
    visit_type: 'energia',
    status: 'inProgress',
  });

  it('abre la visita al pulsarla y permite ver todas', async () => {
    const onOpenVisit = jest.fn();
    const onSeeAll = jest.fn();
    await render(
      <InProgressSection visits={[visit]} onOpenVisit={onOpenVisit} onSeeAll={onSeeAll} />,
    );

    expect(screen.getByText('Industrias XYZ · Inspección de Energía')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Abrir visita VT-00002 — Inspección Energía' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Ver todas las visitas' }));

    expect(onOpenVisit).toHaveBeenCalledWith('v1');
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('explica qué hacer cuando no hay visitas en progreso', async () => {
    await render(<InProgressSection visits={[]} onOpenVisit={jest.fn()} onSeeAll={jest.fn()} />);

    expect(screen.getByText(/No tienes visitas en progreso/)).toBeOnTheScreen();
  });
});

describe('QuickActions', () => {
  it('ofrece "Mis visitas" y "Nueva visita"', async () => {
    const onMyVisits = jest.fn();
    const onNewVisit = jest.fn();
    await render(<QuickActions onMyVisits={onMyVisits} onNewVisit={onNewVisit} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Mis visitas' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Nueva visita' }));

    expect(onMyVisits).toHaveBeenCalledTimes(1);
    expect(onNewVisit).toHaveBeenCalledTimes(1);
  });

  it('ofrece "Inventario" si se indica la acción', async () => {
    const onInventory = jest.fn();
    await render(<QuickActions onMyVisits={jest.fn()} onInventory={onInventory} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Inventario' }));

    expect(onInventory).toHaveBeenCalledTimes(1);
  });

  it('oculta "Nueva visita" para quien no puede crear visitas', async () => {
    await render(<QuickActions onMyVisits={jest.fn()} />);

    expect(screen.queryByRole('button', { name: 'Nueva visita' })).toBeNull();
  });
});

describe('SyncStatusCard', () => {
  afterEach(() => useSyncStore.getState().reset());

  it('describe el estado sin conexión con los cambios pendientes', async () => {
    useSyncStore.getState().setSnapshot({ state: 'offline', pendingCount: 2, lastSyncedAt: null });
    await render(<SyncStatusCard />);

    expect(screen.getByText('Sin conexión')).toBeOnTheScreen();
    expect(screen.getByText(/2 pendientes de enviar/)).toBeOnTheScreen();
    expect(screen.queryByText(/Última sincronización/)).toBeNull();
  });

  it('muestra la última sincronización cuando está al día', async () => {
    useSyncStore.getState().setSnapshot({
      state: 'synced',
      pendingCount: 0,
      lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    await render(<SyncStatusCard />);

    expect(screen.getByText('Sincronizado')).toBeOnTheScreen();
    expect(screen.getByText('Última sincronización: hace 5 min')).toBeOnTheScreen();
  });
});
