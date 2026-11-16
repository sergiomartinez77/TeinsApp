import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PhotoSyncStatus, VisitPhoto } from '@/models/photo.model';

import { PhotoFabs } from '../components/PhotoFabs';
import { PhotoThumbnail } from '../components/PhotoThumbnail';
import { SyncDot } from '../components/SyncDot';

jest.mock('../hooks/usePhotoSource', () => ({
  usePhotoSource: () => ({
    source: { uri: 'file:///documentos/teins_photos/p1.jpg', cacheKey: 'local-p1' },
    isLoading: false,
  }),
}));

const photo = (overrides: Partial<VisitPhoto> = {}): VisitPhoto => ({
  id: 'p1',
  visitId: 'v1',
  formFieldId: null,
  localPath: 'teins_photos/p1.jpg',
  storagePath: null,
  storageUrl: null,
  caption: null,
  syncStatus: 'local',
  capturedAt: '2026-06-01T10:00:00.000Z',
  uploadedAt: null,
  fileSizeBytes: 1000,
  width: 1920,
  height: 1080,
  ...overrides,
});

describe('SyncDot', () => {
  it.each<[PhotoSyncStatus, string]>([
    ['local', 'En el dispositivo'],
    ['pendingUpload', 'Por subir'],
    ['uploading', 'Subiendo'],
    ['uploaded', 'Subida'],
    ['uploadError', 'Error al subir'],
  ])('con estado %s se anuncia como "%s"', async (status, label) => {
    await render(<SyncDot status={status} />);
    expect(screen.getByLabelText(label)).toBeOnTheScreen();
  });
});

describe('PhotoThumbnail', () => {
  it('avisa al tocar y al mantener pulsado', async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const item = photo({ syncStatus: 'uploaded' });
    await render(
      <PhotoThumbnail photo={item} size={120} onPress={onPress} onLongPress={onLongPress} />,
    );

    const tile = screen.getByRole('imagebutton');
    expect(tile.props.accessibilityLabel).toContain('Subida');

    await fireEvent.press(tile);
    expect(onPress).toHaveBeenCalledWith(item);
    await fireEvent(tile, 'longPress');
    expect(onLongPress).toHaveBeenCalledWith(item);
  });

  it('en solo lectura mantener pulsado no hace nada', async () => {
    const onPress = jest.fn();
    await render(<PhotoThumbnail photo={photo()} size={120} onPress={onPress} />);

    const tile = screen.getByRole('imagebutton');
    expect(tile.props.accessibilityHint).toBe('Toca para verla.');
    await fireEvent(tile, 'longPress');
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('PhotoFabs', () => {
  it('ofrece la galería y la cámara', async () => {
    const onCamera = jest.fn();
    const onLibrary = jest.fn();
    await render(<PhotoFabs readOnly={false} onCamera={onCamera} onLibrary={onLibrary} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Tomar fotografía' }));
    expect(onCamera).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Elegir de la galería' }));
    expect(onLibrary).toHaveBeenCalledTimes(1);
  });

  it('en solo lectura no muestra botones', async () => {
    await render(<PhotoFabs readOnly onCamera={jest.fn()} onLibrary={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('se desactivan mientras se procesa una captura', async () => {
    await render(
      <PhotoFabs readOnly={false} disabled onCamera={jest.fn()} onLibrary={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Tomar fotografía' })).toBeDisabled();
  });
});
