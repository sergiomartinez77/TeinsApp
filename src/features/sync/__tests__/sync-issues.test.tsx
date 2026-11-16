import { render, renderHook, screen } from '@testing-library/react-native';

import { SyncStatusCard } from '@/features/home/components/SyncStatusCard';
import { useSyncStore } from '@/store/sync.store';

import { SYNC_ISSUE_COUNT_SQL, useSyncIssueCount } from '../hooks/useSyncIssueCount';
import { syncIssuesNotice } from '../sync-state';

const mockUseQuery = jest.fn();
jest.mock('@powersync/react', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

afterEach(() => {
  mockUseQuery.mockReset();
  useSyncStore.getState().reset();
});

describe('syncIssuesNotice', () => {
  it('usa singular y plural y no avisa si no hay cambios rechazados', () => {
    expect(syncIssuesNotice(0)).toBeNull();
    expect(syncIssuesNotice(1)).toBe('1 cambio no pudo enviarse y quedó guardado para revisión.');
    expect(syncIssuesNotice(3)).toBe(
      '3 cambios no pudieron enviarse y quedaron guardados para revisión.',
    );
  });
});

describe('useSyncIssueCount', () => {
  it('cuenta las filas de la tabla local de cambios rechazados', async () => {
    mockUseQuery.mockReturnValue({ data: [{ count: 2 }], isLoading: false });
    const { result } = await renderHook(() => useSyncIssueCount());

    expect(mockUseQuery).toHaveBeenCalledWith(SYNC_ISSUE_COUNT_SQL);
    expect(SYNC_ISSUE_COUNT_SQL).toBe('SELECT COUNT(*) AS count FROM sync_issues');
    expect(result.current).toBe(2);
  });

  it('mientras carga o si el valor no es válido cuenta cero', async () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: true });
    const loading = await renderHook(() => useSyncIssueCount());
    expect(loading.result.current).toBe(0);

    mockUseQuery.mockReturnValue({ data: [{ count: 'x' }], isLoading: false });
    const invalid = await renderHook(() => useSyncIssueCount());
    expect(invalid.result.current).toBe(0);
  });
});

describe('SyncStatusCard con cambios rechazados', () => {
  beforeEach(() => {
    useSyncStore.getState().setSnapshot({ state: 'synced', pendingCount: 0, lastSyncedAt: null });
  });

  it('muestra el aviso con el conteo y lo incluye en la etiqueta accesible', async () => {
    await render(<SyncStatusCard rejectedCount={4} />);

    const notice = '4 cambios no pudieron enviarse y quedaron guardados para revisión.';
    expect(screen.getByText(notice)).toBeOnTheScreen();
    expect(screen.getByTestId('sync-status-card').props.accessibilityLabel).toContain(notice);
  });

  it('sin cambios rechazados no muestra el aviso', async () => {
    await render(<SyncStatusCard />);
    expect(screen.queryByTestId('sync-issues-notice')).toBeNull();
  });
});
