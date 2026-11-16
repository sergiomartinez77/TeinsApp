import { act, renderHook } from '@testing-library/react-native';

import { parseElements, type VisitAnnotation } from '@/models/annotation.model';

import { useAnnotationEditor } from '../hooks/useAnnotationEditor';

import { createAnnotationDb } from './fake-annotation-db';

let mockDb = createAnnotationDb();
let mockIdCounter = 0;

jest.mock('@powersync/react', () => ({ usePowerSync: () => mockDb.db }));
jest.mock('@/utils/uuid.utils', () => ({
  generateId: () => {
    mockIdCounter += 1;
    return `id-${mockIdCounter}`;
  },
}));

const CANVAS = { width: 300, height: 400 };

const setup = (options: { readOnly?: boolean; initial?: VisitAnnotation | null } = {}) =>
  renderHook(() =>
    useAnnotationEditor({
      visitId: 'v1',
      technicianId: 't1',
      initial: options.initial ?? null,
      readOnly: options.readOnly ?? false,
    }),
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockDb = createAnnotationDb();
  mockIdCounter = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useAnnotationEditor', () => {
  it('al dibujar fija la referencia y guarda tras 1600 ms', async () => {
    const { result } = await setup();

    await act(async () => result.current.draw({ points: [{ x: 30, y: 40 }], canvasSize: CANVAS }));
    expect(result.current.elements).toHaveLength(1);
    expect(result.current.reference).toEqual(CANVAS);

    await act(async () => {
      jest.advanceTimersByTime(1599);
    });
    expect(mockDb.rows.size).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    const row = [...mockDb.rows.values()][0];
    expect(row).toMatchObject({ canvas_width: 300, canvas_height: 400 });
    expect(parseElements(row?.elements)).toHaveLength(1);
    expect(result.current.autosaveStatus).toBe('saved');
  });

  it('con el texto abre el diálogo y añade el elemento al confirmar', async () => {
    const { result } = await setup();

    await act(async () => result.current.setTool('text'));
    await act(async () => result.current.draw({ points: [{ x: 30, y: 40 }], canvasSize: CANVAS }));
    expect(result.current.isWritingText).toBe(true);
    expect(result.current.elements).toHaveLength(0);

    await act(async () => result.current.confirmText('Rack 2'));

    expect(result.current.isWritingText).toBe(false);
    expect(result.current.elements[0]).toMatchObject({ type: 'text', text: 'Rack 2' });
  });

  it('borrar y deshacer cambian la lista', async () => {
    const { result } = await setup();

    await act(async () => result.current.draw({ points: [{ x: 30, y: 40 }], canvasSize: CANVAS }));
    const id = result.current.elements[0]?.id ?? '';
    await act(async () => result.current.erase([id]));
    expect(result.current.elements).toHaveLength(0);

    await act(async () => result.current.undo());
    expect(result.current.elements).toHaveLength(1);
  });

  it('guardar ahora guarda sin esperar', async () => {
    const { result } = await setup();

    await act(async () => result.current.draw({ points: [{ x: 30, y: 40 }], canvasSize: CANVAS }));
    await act(async () => result.current.saveNow());

    expect(mockDb.rows.size).toBe(1);
  });

  it('al abrir no guarda nada y conserva la referencia guardada', async () => {
    const initial: VisitAnnotation = {
      id: 'a1',
      visitId: 'v1',
      title: null,
      elements: [],
      baseImagePath: null,
      canvasWidth: 390,
      canvasHeight: 600,
      syncStatus: 'synced',
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: null,
    };
    const { result } = await setup({ initial });

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.reference).toEqual({ width: 390, height: 600 });
    expect(mockDb.statements).toEqual([]);
  });

  it('en solo lectura no dibuja', async () => {
    const { result } = await setup({ readOnly: true });

    await act(async () => result.current.draw({ points: [{ x: 30, y: 40 }], canvasSize: CANVAS }));

    expect(result.current.elements).toHaveLength(0);
  });
});
