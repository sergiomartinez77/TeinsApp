import { File, Paths } from 'expo-file-system';

import {
  devicePhotoFiles,
  discardFile,
  fileSizeAt,
  photoRelativePath,
  photoTrashDirectory,
} from '../services/photo-files';
import { devicePhotoTrash, purgePhotoTrash } from '../services/photo-trash';

/**
 * Archivos de fotos sobre el sistema de archivos en memoria que simula
 * jest-expo para `expo-file-system` (no es el del dispositivo: los permisos,
 * el espacio libre y las rutas reales de iOS/Android se prueban a mano).
 */

const tempFile = (name: string, content = 'jpeg') => {
  const file = new File(Paths.cache, name);
  file.write(content);
  return file;
};

describe('devicePhotoFiles', () => {
  it('save mueve el temporal a teins_photos/<id>.jpg y devuelve su tamaño', async () => {
    const source = tempFile('comprimida-1.jpg', '123456');
    const relative = photoRelativePath('foto-1');

    expect(relative).toBe('teins_photos/foto-1.jpg');
    expect(await devicePhotoFiles.save(source.uri, relative)).toEqual({ size: 6 });
    expect(source.exists).toBe(false);
    expect(devicePhotoFiles.exists(relative)).toBe(true);
    expect(devicePhotoFiles.absoluteUri(relative)).toBe(
      'file:///mock/document/teins_photos/foto-1.jpg',
    );
    expect(new Uint8Array(await devicePhotoFiles.read(relative))).toHaveLength(6);
  });

  it('remove borra el archivo y no falla si ya no existe', async () => {
    const relative = photoRelativePath('foto-2');
    await devicePhotoFiles.save(tempFile('comprimida-2.jpg').uri, relative);

    await devicePhotoFiles.remove(relative);
    expect(devicePhotoFiles.exists(relative)).toBe(false);
    await expect(devicePhotoFiles.remove(relative)).resolves.toBeUndefined();
  });

  it('moveToTrash lleva el archivo a la papelera de la caché', async () => {
    const relative = photoRelativePath('foto-3');
    await devicePhotoFiles.save(tempFile('comprimida-3.jpg').uri, relative);

    await devicePhotoFiles.moveToTrash(relative, '1000_foto-3.jpg');

    expect(devicePhotoFiles.exists(relative)).toBe(false);
    expect(new File(photoTrashDirectory(), '1000_foto-3.jpg').exists).toBe(true);
  });

  it('exists es falso para una ruta vacía', () => {
    expect(devicePhotoFiles.exists('')).toBe(false);
  });
});

describe('archivos temporales', () => {
  it('fileSizeAt devuelve el tamaño o 0 si no existe', () => {
    const file = tempFile('medida.jpg', 'abc');
    expect(fileSizeAt(file.uri)).toBe(3);
    expect(fileSizeAt(`${Paths.cache.uri}no-existe.jpg`)).toBe(0);
  });

  it('discardFile solo borra dentro de la caché y nunca lanza', () => {
    const temp = tempFile('descartar.jpg');
    discardFile(temp.uri);
    expect(temp.exists).toBe(false);

    const own = new File(Paths.document, 'del-usuario.jpg');
    own.write('x');
    discardFile(own.uri);
    expect(own.exists).toBe(true);

    expect(() => discardFile(`${Paths.cache.uri}no-existe.jpg`)).not.toThrow();
  });
});

describe('papelera del dispositivo (devicePhotoTrash)', () => {
  it('sin carpeta no hay nada; con archivos borra solo los caducados', async () => {
    const folder = photoTrashDirectory();
    if (folder.exists) folder.delete();
    expect(devicePhotoTrash.list()).toEqual([]);

    const now = new Date('2026-06-10T12:00:00.000Z');
    const old = `${now.getTime() - 8 * 24 * 60 * 60 * 1000}_vieja.jpg`;
    const recent = `${now.getTime() - 60 * 1000}_reciente.jpg`;
    for (const name of [old, recent]) {
      const relative = photoRelativePath(name);
      await devicePhotoFiles.save(tempFile(`papelera-${name}`).uri, relative);
      await devicePhotoFiles.moveToTrash(relative, name);
    }
    expect(devicePhotoTrash.list().sort()).toEqual([old, recent].sort());

    expect(await purgePhotoTrash(devicePhotoTrash, now)).toBe(1);
    expect(devicePhotoTrash.list()).toEqual([recent]);
    expect(() => devicePhotoTrash.remove('no-existe.jpg')).not.toThrow();
  });
});
