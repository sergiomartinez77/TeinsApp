import {
  isTrashExpired,
  photoTrashName,
  purgePhotoTrash,
  trashEnteredAt,
  type PhotoTrashStore,
} from '../services/photo-trash';

jest.mock('@/utils/logger', () => ({
  scopedLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-10T12:00:00.000Z');
const nameAgo = (ms: number, id: string) => `${NOW.getTime() - ms}_${id}.jpg`;

/** Papelera falsa en memoria. */
function createTrash(names: string[] | null) {
  const files = new Set(names ?? []);
  const store: PhotoTrashStore & { remove: jest.Mock } = {
    list: () => (names === null ? [] : [...files]),
    remove: jest.fn((name: string) => {
      files.delete(name);
    }),
  };
  return { store, files };
}

describe('nombre en la papelera', () => {
  it('codifica el momento de entrada y se puede leer de vuelta', () => {
    const name = photoTrashName('abc-123', NOW);
    expect(name).toBe(`${NOW.getTime()}_abc-123.jpg`);
    expect(trashEnteredAt(name)).toBe(NOW.getTime());
  });

  it('un nombre irreconocible no tiene fecha y se considera caducado', () => {
    expect(trashEnteredAt('foto.jpg')).toBeNull();
    expect(isTrashExpired('foto.jpg', NOW)).toBe(true);
    expect(isTrashExpired('123_abc.png', NOW)).toBe(true);
  });
});

describe('purgePhotoTrash', () => {
  it('conserva los de menos de 7 días y borra los de 7 días o más', async () => {
    const fresh = nameAgo(0, 'nueva');
    const sixDays = nameAgo(7 * DAY - 1, 'casi');
    const sevenDays = nameAgo(7 * DAY, 'justo');
    const old = nameAgo(30 * DAY, 'vieja');
    const { store, files } = createTrash([fresh, sixDays, sevenDays, old]);

    const removed = await purgePhotoTrash(store, NOW);

    expect(removed).toBe(2);
    expect([...files].sort()).toEqual([fresh, sixDays].sort());
  });

  it('borra los archivos con nombre irreconocible', async () => {
    const fresh = nameAgo(DAY, 'nueva');
    const { store, files } = createTrash([fresh, 'desconocido.jpg', 'nota.txt']);

    await purgePhotoTrash(store, NOW);

    expect([...files]).toEqual([fresh]);
  });

  it('no falla si la carpeta no existe', async () => {
    const { store } = createTrash(null);
    await expect(purgePhotoTrash(store, NOW)).resolves.toBe(0);
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('no falla si listar la carpeta lanza', async () => {
    const store: PhotoTrashStore = {
      list: () => {
        throw new Error('sin acceso');
      },
      remove: jest.fn(),
    };
    await expect(purgePhotoTrash(store, NOW)).resolves.toBe(0);
  });

  it('si un borrado lanza, sigue con los demás y no falla', async () => {
    const first = nameAgo(10 * DAY, 'a');
    const second = nameAgo(10 * DAY, 'b');
    const { store, files } = createTrash([first, second]);
    store.remove.mockImplementationOnce(() => {
      throw new Error('archivo bloqueado');
    });

    await expect(purgePhotoTrash(store, NOW)).resolves.toBe(1);
    expect(store.remove).toHaveBeenCalledTimes(2);
    expect(files.has(first)).toBe(true);
    expect(files.has(second)).toBe(false);
  });
});
