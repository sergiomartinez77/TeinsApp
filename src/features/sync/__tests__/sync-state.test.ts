import { signOutMessage } from '@/features/auth/hooks/useSignOut';
import { colors } from '@/theme';

import { describeSyncState, deriveSyncState, type SyncInputs, type SyncState } from '../sync-state';

const inputs = (overrides: Partial<SyncInputs> = {}): SyncInputs => ({
  isDemo: false,
  isOnline: true,
  connected: true,
  connecting: false,
  uploading: false,
  downloading: false,
  hasError: false,
  pendingCount: 0,
  ...overrides,
});

describe('deriveSyncState', () => {
  it('todo al día → sincronizado', () => {
    expect(deriveSyncState(inputs())).toBe('synced');
  });

  it('el modo demo tiene prioridad sobre todo lo demás', () => {
    expect(deriveSyncState(inputs({ isDemo: true, isOnline: false, hasError: true }))).toBe('demo');
  });

  it('sin red es un estado normal, no un error', () => {
    expect(
      deriveSyncState(
        inputs({ isOnline: false, connected: false, hasError: true, pendingCount: 4 }),
      ),
    ).toBe('offline');
  });

  it('transfiriendo datos → sincronizando, aunque haya un error anterior', () => {
    expect(deriveSyncState(inputs({ uploading: true, hasError: true }))).toBe('syncing');
    expect(deriveSyncState(inputs({ downloading: true }))).toBe('syncing');
  });

  it('con red y fallo → error', () => {
    expect(deriveSyncState(inputs({ connected: false, hasError: true }))).toBe('error');
    expect(deriveSyncState(inputs({ hasError: true, pendingCount: 2 }))).toBe('error');
  });

  it('conectando o aún sin conectar → sincronizando', () => {
    expect(deriveSyncState(inputs({ connected: false, connecting: true }))).toBe('syncing');
    expect(deriveSyncState(inputs({ connected: false }))).toBe('syncing');
  });

  it('conectado con cambios por subir → pendiente', () => {
    expect(deriveSyncState(inputs({ pendingCount: 3 }))).toBe('pending');
  });
});

describe('describeSyncState', () => {
  const states: SyncState[] = ['offline', 'syncing', 'pending', 'synced', 'error', 'demo'];

  it.each(states)('%s tiene etiqueta, descripción, color e icono', (state) => {
    const info = describeSyncState(state, 2);
    expect(info.label.length).toBeGreaterThan(0);
    expect(info.description.length).toBeGreaterThan(0);
    expect(info.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(info.icon.length).toBeGreaterThan(0);
  });

  it('usa los colores de sincronización del tema', () => {
    expect(describeSyncState('offline', 0).color).toBe(colors.offline);
    expect(describeSyncState('syncing', 0).color).toBe(colors.syncing);
    expect(describeSyncState('pending', 1).color).toBe(colors.pendingSync);
    expect(describeSyncState('synced', 0).color).toBe(colors.synced);
  });

  it('concuerda singular y plural', () => {
    expect(describeSyncState('pending', 1).label).toBe('1 pendiente');
    expect(describeSyncState('pending', 5).label).toBe('5 pendientes');
    expect(describeSyncState('pending', 1).description).toMatch(/Hay 1 cambio por enviar/);
    expect(describeSyncState('pending', 5).description).toMatch(/Hay 5 cambios por enviar/);
  });

  it('sin conexión tranquiliza sobre los cambios pendientes', () => {
    expect(describeSyncState('offline', 3).description).toMatch(/se sincronizarán solos/);
    expect(describeSyncState('offline', 0).description).toMatch(/se guardan en el dispositivo/);
  });
});

describe('signOutMessage', () => {
  it('avisa de los cambios sin sincronizar y de que no se pierden', () => {
    expect(signOutMessage(false, 1)).toMatch(/Tienes 1 cambio sin sincronizar\. Se conservarán/);
    expect(signOutMessage(false, 4)).toMatch(/Tienes 4 cambios sin sincronizar/);
  });

  it('usa una confirmación simple cuando no hay pendientes', () => {
    expect(signOutMessage(false, 0)).toBe('¿Quieres cerrar tu sesión en este dispositivo?');
  });

  it('en modo demo avisa de que los datos de ejemplo se borran', () => {
    expect(signOutMessage(true, 9)).toMatch(/se borran los datos de ejemplo/);
  });
});
