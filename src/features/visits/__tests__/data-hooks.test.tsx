import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';

import { useDashboard } from '@/features/home/hooks/useDashboard';
import { useMaterialActions } from '@/features/materials/hooks/useMaterialActions';
import { useVisitMaterials } from '@/features/materials/hooks/useVisitMaterials';
import { useAuthStore } from '@/store/auth.store';
import { catalogRow, TECH_A, TECH_B, visitRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

import { useVisitActions } from '../hooks/useVisitActions';
import { useVisit, useVisits } from '../hooks/useVisits';

/**
 * Hooks de datos de visitas, dashboard y materiales sobre SQLite real: las
 * consultas reactivas se vuelven a ejecutar al escribir.
 */

jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

let db: TestDatabase;

beforeEach(() => {
  resetIds('nuevo');
  db = createTestDatabase();
  setTestDatabase(db);
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: TECH_A,
      email: 'a@test',
      role: 'technician',
      fullName: 'Técnico A',
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

const day = (index: number) => `2026-06-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`;

describe('useVisits', () => {
  it('pagina de 20 en 20 y vuelve a la primera página al cambiar de pestaña', async () => {
    db.insert(
      'visits',
      Array.from({ length: 25 }, (_, index) =>
        visitRow({ id: `v${index}`, created_at: day(index), status: 'assigned' }),
      ),
    );
    const { result, rerender } = await renderHook(
      (props: { filter: 'all' | 'assigned' }) => useVisits(TECH_A, props.filter, ''),
      { initialProps: { filter: 'all' } },
    );

    expect(result.current.visits).toHaveLength(20);
    expect(result.current.visits[0]?.id).toBe('v24');
    expect(result.current.hasMore).toBe(true);

    await act(async () => result.current.loadMore());
    expect(result.current.visits).toHaveLength(25);
    expect(result.current.hasMore).toBe(false);
    // Sin más páginas, pedir más no hace nada.
    await act(async () => result.current.loadMore());
    expect(result.current.visits).toHaveLength(25);

    await rerender({ filter: 'assigned' });
    expect(result.current.visits).toHaveLength(20);

    await act(async () => result.current.refresh());
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.hasError).toBe(false);
  });

  it('useVisit se actualiza al cambiar el estado y no ve visitas ajenas', async () => {
    db.insert('visits', [visitRow({ id: 'v1' }), visitRow({ id: 'ajena', technician_id: TECH_B })]);
    const own = await renderHook(() => useVisit(TECH_A, 'v1'));
    const foreign = await renderHook(() => useVisit(TECH_A, 'ajena'));

    expect(own.result.current.visit?.status).toBe('assigned');
    expect(foreign.result.current.visit).toBeNull();

    const actions = await renderHook(() => useVisitActions(), { wrapper });
    await act(async () => {
      await actions.result.current.start.mutateAsync('v1');
    });
    expect(own.result.current.visit?.status).toBe('inProgress');
  });
});

describe('useVisitActions', () => {
  it('crea visitas y avisa en español si una transición falla', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { result } = await renderHook(() => useVisitActions(), { wrapper });

    await act(async () => {
      await result.current.create.mutateAsync({
        title: 'Nueva',
        visitType: 'datos',
        address: null,
        description: null,
      });
    });
    expect(db.rows('visits')).toMatchObject([{ id: 'nuevo-1', technician_id: TECH_A }]);

    await act(async () => {
      await result.current.complete.mutateAsync('nuevo-1').catch(() => undefined);
    });
    expect(alert).toHaveBeenCalledWith(
      'No se pudo finalizar la visita',
      'Una visita asignada no puede pasar a completada.',
    );
    await act(async () => {
      await result.current.start.mutateAsync('no-existe').catch(() => undefined);
    });
    expect(alert).toHaveBeenLastCalledWith(
      'No se pudo iniciar la visita',
      'No se encontró la visita. Es posible que ya no esté asignada a ti.',
    );
  });
});

describe('useDashboard', () => {
  it('cuenta y lista las en progreso (máximo 3), reactivo y con refresco', async () => {
    db.insert('visits', [
      visitRow({ id: 'a', status: 'assigned' }),
      ...[1, 2, 3, 4].map((index) =>
        visitRow({ id: `p${index}`, status: 'inProgress', started_at: day(index) }),
      ),
    ]);
    const { result } = await renderHook(() => useDashboard(TECH_A));

    expect(result.current.stats).toEqual({
      assigned: 1,
      inProgress: 4,
      completed: 0,
      pendingSync: 0,
    });
    expect(result.current.inProgress.map((visit) => visit.id)).toEqual(['p4', 'p3', 'p2']);

    await act(async () => {
      db.insert('visits', [visitRow({ id: 'c', status: 'completed', sync_status: 'local' })]);
    });
    expect(result.current.stats).toMatchObject({ completed: 1, pendingSync: 1 });

    await act(async () => result.current.refresh());
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.hasError).toBe(false);
  });
});

describe('useMaterialActions y useVisitMaterials', () => {
  it('agrega, edita y quita; la lista y el resumen se actualizan solos', async () => {
    db.insert('visits', [visitRow({ id: 'v1', status: 'inProgress' })]);
    db.insert('material_catalog', [catalogRow({ id: 'm1', unit: 'metro' })]);
    const list = await renderHook(() => useVisitMaterials('v1'));
    const { result } = await renderHook(() => useMaterialActions('v1'), { wrapper });

    await act(async () => {
      await result.current.add.mutateAsync({ materialId: 'm1', quantity: 3, observations: null });
    });
    expect(list.result.current.summary.countLabel).toBe('1 material');
    expect(list.result.current.materialIds.has('m1')).toBe(true);

    await act(async () => {
      await result.current.update.mutateAsync({
        visitMaterialId: 'nuevo-1',
        quantity: 7.5,
        observations: 'ok',
      });
    });
    expect(list.result.current.summary.totalsLabel).toBe('7,5 metro');

    await act(async () => {
      await result.current.remove.mutateAsync('nuevo-1');
    });
    expect(list.result.current.materials).toEqual([]);
    await act(async () => list.result.current.refresh());
    expect(list.result.current.hasError).toBe(false);
  });

  it('si quitar falla, avisa en español', async () => {
    db.insert('visits', [visitRow({ id: 'v1', status: 'completed' })]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { result } = await renderHook(() => useMaterialActions('v1'), { wrapper });

    await act(async () => {
      await result.current.remove.mutateAsync('x').catch(() => undefined);
    });
    expect(alert).toHaveBeenCalledWith(
      'No se pudo quitar el material',
      'La visita está cerrada y sus materiales ya no se pueden modificar.',
    );
  });
});
