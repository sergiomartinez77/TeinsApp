import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { File, Paths } from 'expo-file-system';
import type { ReactNode } from 'react';
import { Alert, Linking, type AlertButton } from 'react-native';

import { photoFromRow, type VisitPhoto } from '@/models/photo.model';
import { useAuthStore } from '@/store/auth.store';
import { photoRow, TECH_A, visitRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

import { PhotoViewer } from '../components/PhotoViewer';
import { usePhotoActions } from '../hooks/usePhotoActions';
import { usePhotoSource } from '../hooks/usePhotoSource';
import { useVisitPhotos } from '../hooks/useVisitPhotos';
import { captureImage } from '../services/photo-capture';
import { devicePhotoFiles } from '../services/photo-files';
import {
  createSignedPhotoUrl,
  photoObjectUrl,
  SIGNED_URL_SECONDS,
  supabasePhotoStorage,
} from '../services/photo-storage';

/**
 * Hooks y visor de fotografías sobre SQLite real y el sistema de archivos en
 * memoria de jest-expo. Se simulan la cámara/galería (`captureImage`) y el
 * almacenamiento remoto de Supabase. Los gestos del visor (deslizar,
 * pellizcar, doble toque) no se pueden reproducir aquí: ver
 * docs/PRUEBAS_MANUALES.md.
 */

jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});
// Reanimated y Worklets necesitan su módulo nativo (el simulador oficial de
// Reanimated 4 tampoco carga en Jest): sustituto mínimo, sin animación.
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args),
}));
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    useSharedValue: (initial: number) => {
      let value = initial;
      return { get: () => value, set: (next: number) => (value = next) };
    },
    useAnimatedStyle: (factory: () => object) => factory(),
    withTiming: (value: number) => value,
    // Lo que usa react-native-gesture-handler cuando detecta Reanimated.
    isSharedValue: () => false,
    useEvent: () => undefined,
    useHandler: () => ({ context: {}, doDependenciesDiffer: false, useWeb: false }),
    useComposedEventHandler: () => undefined,
    setGestureState: () => undefined,
  };
});
jest.mock('../services/photo-capture', () => ({ captureImage: jest.fn() }));

const mockBucket = {
  upload: jest.fn(async () => ({ error: null as Error | null })),
  createSignedUrl: jest.fn(async (path: string) => ({
    data: { signedUrl: `https://firmada.test/${path}?token=1` },
    error: null as Error | null,
  })),
};
jest.mock('@/services/supabase/client', () => ({
  getSupabase: () => ({ storage: { from: () => mockBucket } }),
}));

let db: TestDatabase;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { gcTime: Infinity } },
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  resetIds('foto');
  db = createTestDatabase();
  db.insert('visits', [
    visitRow({ id: 'v1', status: 'inProgress' }),
    visitRow({ id: 'v-cerrada', status: 'completed' }),
  ]);
  setTestDatabase(db);
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: TECH_A,
      email: 'a@test',
      role: 'technician',
      fullName: 'A',
      phone: null,
      avatarUrl: null,
    },
  });
});

afterEach(() => {
  // Vacía la caché: si no, sus temporizadores de limpieza mantienen vivo Jest.
  queryClient.clear();
  setTestDatabase(null);
  jest.restoreAllMocks();
});

describe('useVisitPhotos', () => {
  it('pagina de 20 en 20, cuenta el total y se actualiza al añadir fotos', async () => {
    db.insert(
      'photos',
      Array.from({ length: 25 }, (_, index) =>
        photoRow({
          id: `p${String(index).padStart(2, '0')}`,
          captured_at: `2026-06-01T08:${String(index).padStart(2, '0')}:00.000Z`,
        }),
      ),
    );
    const { result } = await renderHook(() => useVisitPhotos('v1'));

    expect(result.current.photos).toHaveLength(20);
    expect(result.current.photos[0]?.id).toBe('p24');
    expect(result.current.total).toBe(25);
    expect(result.current.hasMore).toBe(true);

    await act(async () => result.current.loadMore());
    expect(result.current.photos).toHaveLength(25);
    expect(result.current.hasMore).toBe(false);

    await act(async () => {
      db.insert('photos', [photoRow({ id: 'nueva', captured_at: '2026-06-02T00:00:00.000Z' })]);
    });
    expect(result.current.photos[0]?.id).toBe('nueva');
    expect(result.current.total).toBe(26);
    await act(async () => result.current.refresh());
    expect(result.current.hasError).toBe(false);
  });
});

describe('usePhotoActions', () => {
  const tempImage = (name: string) => {
    const file = new File(Paths.cache, name);
    file.write('jpeg-comprimido');
    return { uri: file.uri, width: 1920, height: 1080, sizeBytes: 15 };
  };

  it('captura: guarda el archivo y registra la foto como local', async () => {
    jest.mocked(captureImage).mockResolvedValueOnce({ ok: true, data: tempImage('c1.jpg') });
    const { result } = await renderHook(() => usePhotoActions('v1'), { wrapper });

    await act(async () => {
      await result.current.capture.mutateAsync('camera');
    });

    expect(db.rows('photos')).toMatchObject([
      { id: 'foto-1', sync_status: 'local', local_path: 'teins_photos/foto-1.jpg', width: 1920 },
    ]);
    expect(devicePhotoFiles.exists('teins_photos/foto-1.jpg')).toBe(true);
  });

  it('cancelar la cámara no registra nada', async () => {
    jest.mocked(captureImage).mockResolvedValueOnce({ ok: true, data: null });
    const { result } = await renderHook(() => usePhotoActions('v1'), { wrapper });

    await act(async () => {
      expect(await result.current.capture.mutateAsync('library')).toBeNull();
    });
    expect(db.rows('photos')).toEqual([]);
  });

  it('en una visita cerrada avisa y descarta el JPEG temporal', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const image = tempImage('c2.jpg');
    jest.mocked(captureImage).mockResolvedValueOnce({ ok: true, data: image });
    const { result } = await renderHook(() => usePhotoActions('v-cerrada'), { wrapper });

    await act(async () => {
      await result.current.capture.mutateAsync('camera').catch(() => undefined);
    });

    expect(alert).toHaveBeenCalledWith(
      'No se pudo guardar la fotografía',
      'La visita está cerrada y sus fotografías ya no se pueden modificar.',
    );
    expect(new File(image.uri).exists).toBe(false);
    expect(db.rows('photos')).toEqual([]);
  });

  it('sin permiso ofrece abrir la configuración del dispositivo', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    let buttons: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, given) => {
      buttons = given ?? [];
    });
    jest.mocked(captureImage).mockResolvedValueOnce({
      ok: false,
      error: { kind: 'permission', message: 'Se necesita permiso.' },
    });
    const { result } = await renderHook(() => usePhotoActions('v1'), { wrapper });

    await act(async () => {
      await result.current.capture.mutateAsync('camera').catch(() => undefined);
    });

    expect(buttons.map((button) => button.text)).toEqual(['Cancelar', 'Abrir configuración']);
    buttons[1]?.onPress?.();
    expect(openSettings).toHaveBeenCalled();
  });

  it('eliminar borra la fila; si falla, avisa', async () => {
    db.insert('photos', [photoRow({ id: 'p1', local_path: '' })]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { result } = await renderHook(() => usePhotoActions('v1'), { wrapper });

    await act(async () => {
      await result.current.remove.mutateAsync('p1');
    });
    expect(db.rows('photos')).toEqual([]);

    await act(async () => {
      await result.current.remove.mutateAsync('p1').catch(() => undefined);
    });
    expect(alert).toHaveBeenCalledWith(
      'No se pudo eliminar la fotografía',
      'No se encontró la fotografía. Es posible que ya se haya eliminado.',
    );
  });
});

describe('usePhotoSource', () => {
  it('usa el archivo local si existe', async () => {
    const file = new File(Paths.document, 'teins_photos/local-1.jpg');
    file.write('x');
    const photo = { id: 'local-1', localPath: 'teins_photos/local-1.jpg', storagePath: 'remoto' };
    const { result } = await renderHook(() => usePhotoSource(photo), { wrapper });

    expect(result.current).toEqual({
      source: { uri: file.uri, cacheKey: 'local-local-1' },
      isLoading: false,
    });
    expect(mockBucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it('sin archivo local pide una URL firmada', async () => {
    const photo = {
      id: 'r1',
      localPath: 'teins_photos/no-esta.jpg',
      storagePath: 'visits/v1/photos/r1.jpg',
    };
    const { result } = await renderHook(() => usePhotoSource(photo), { wrapper });

    await waitFor(() =>
      expect(result.current.source).toEqual({
        uri: 'https://firmada.test/visits/v1/photos/r1.jpg?token=1',
        cacheKey: 'remote-r1',
      }),
    );
    expect(mockBucket.createSignedUrl).toHaveBeenCalledWith(
      'visits/v1/photos/r1.jpg',
      SIGNED_URL_SECONDS,
    );
  });

  it('sin archivo ni copia remota no hay origen', async () => {
    const photo = { id: 'x', localPath: '', storagePath: null };
    const { result } = await renderHook(() => usePhotoSource(photo), { wrapper });
    expect(result.current).toEqual({ source: null, isLoading: false });
  });
});

describe('photo-storage', () => {
  it('sube con upsert y construye la URL del objeto', async () => {
    const content = new ArrayBuffer(4);
    await supabasePhotoStorage.upload('visits/v1/photos/p.jpg', content);
    expect(mockBucket.upload).toHaveBeenCalledWith('visits/v1/photos/p.jpg', content, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    expect(photoObjectUrl('https://x.supabase.co//', 'a/b.jpg')).toBe(
      'https://x.supabase.co/storage/v1/object/visit-photos/a/b.jpg',
    );
    expect(supabasePhotoStorage.objectUrl('a.jpg')).toMatch(
      /\/storage\/v1\/object\/visit-photos\/a\.jpg$/,
    );
  });

  it('propaga los errores del servidor', async () => {
    mockBucket.upload.mockResolvedValueOnce({ error: new Error('cuota') });
    await expect(supabasePhotoStorage.upload('p.jpg', new ArrayBuffer(1))).rejects.toThrow('cuota');
    mockBucket.createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: '' },
      error: new Error('sin permiso'),
    });
    await expect(createSignedPhotoUrl('p.jpg')).rejects.toThrow('sin permiso');
  });
});

describe('PhotoViewer y ZoomableImage (montaje y acciones)', () => {
  const photos: VisitPhoto[] = ['a', 'b', 'c'].map((id) =>
    photoFromRow(
      photoRow({
        id,
        local_path: '',
        storage_path: null,
        caption: id === 'a' ? 'Tablero principal' : null,
        sync_status: id === 'a' ? 'uploaded' : 'local',
      }),
    ),
  );
  const firstWithFile = () => {
    const file = new File(Paths.document, 'teins_photos/a.jpg');
    file.write('x');
    return [{ ...photos[0], localPath: 'teins_photos/a.jpg' } as VisitPhoto, ...photos.slice(1)];
  };

  it('muestra el contador, el pie y la imagen; cerrar y eliminar avisan', async () => {
    const onClose = jest.fn();
    const onDelete = jest.fn();
    await render(
      <PhotoViewer
        photos={firstWithFile()}
        total={7}
        initialIndex={0}
        readOnly={false}
        onClose={onClose}
        onDelete={onDelete}
      />,
      { wrapper },
    );

    expect(screen.getByLabelText('Fotografía 1 de 7')).toHaveTextContent('1 / 7');
    expect(screen.getByText('Tablero principal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Fotografía 1')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('photo-viewer-close'));
    expect(onClose).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('photo-viewer-delete'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('en solo lectura no ofrece eliminar y avisa si la foto no está disponible', async () => {
    await render(
      <PhotoViewer
        photos={photos}
        total={3}
        initialIndex={9}
        readOnly
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />,
      { wrapper },
    );

    // Un índice fuera de rango se ajusta a la última foto.
    expect(screen.getByText('3 / 3')).toBeOnTheScreen();
    expect(screen.queryByTestId('photo-viewer-delete')).toBeNull();
    expect(
      screen.getAllByText('La fotografía no está disponible sin conexión.').length,
    ).toBeGreaterThan(0);
  });
});
