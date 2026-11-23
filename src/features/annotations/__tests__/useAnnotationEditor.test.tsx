import { act, renderHook } from '@testing-library/react-native';

import {
  annotationFromRow,
  parseElements,
  type AnnotationElement,
  type AnnotationFigure,
} from '@/models/annotation.model';
import { annotationRow, TECH_A, visitRow } from '@/test-utils/fixtures';
import { setTestDatabase } from '@/test-utils/powersync-react';
import { resetIds } from '@/test-utils/sequential-ids';
import { createTestDatabase, type Row, type TestDatabase } from '@/test-utils/test-database';

import { ANNOTATION_DEFAULTS, ANNOTATION_PALETTE, strokeSizeById } from '../constants';
import { useAnnotationEditor } from '../hooks/useAnnotationEditor';
import { ANNOTATION_BY_ID_SQL } from '../services/annotation.queries';

/** Editor de un plano sobre la base SQLite real (sin simular el servicio). */

jest.mock('@powersync/react', () => jest.requireActual('@/test-utils/powersync-react'));
jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

const OPENED_AT = '2026-06-01T09:00:00.000Z';
const RED = ANNOTATION_PALETTE[1]?.argb ?? 0;

/** Arrastre de 1 m en horizontal con la vista a 1 px por cm. */
const DRAG = {
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  scale: 1,
};

const existing: AnnotationElement = {
  id: 'guardado',
  type: 'marker',
  points: [{ x: 10, y: 10 }],
  color: 0xff000000,
  strokeWidth: 3,
  text: null,
  fontSize: null,
  opacity: 1,
};

const figure: AnnotationFigure = {
  id: 'f1',
  technicianId: TECH_A,
  name: 'Puerta',
  elements: [
    {
      id: 'fe1',
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 200 },
      ],
      color: 0xff000000,
      strokeWidth: 3,
      text: null,
      fontSize: null,
      opacity: 1,
    },
    { ...existing, id: 'fe2', points: [{ x: 50, y: 100 }] },
  ],
  width: 100,
  height: 200,
  createdAt: OPENED_AT,
};

let db: TestDatabase;

const planRow = (id = 'a1') => db.rows('annotations').find((row) => row.id === id);
const storedElements = (id = 'a1') => parseElements(planRow(id)?.elements);

const setup = async (options: { readOnly?: boolean; visitId?: string } = {}) => {
  const initial = annotationFromRow(await db.get<Row>(ANNOTATION_BY_ID_SQL, ['a1']));
  return renderHook(() =>
    useAnnotationEditor({
      visitId: options.visitId ?? 'v1',
      technicianId: TECH_A,
      initial,
      readOnly: options.readOnly ?? false,
    }),
  );
};

/** Avanza los temporizadores y deja terminar el guardado (promesas de SQLite). */
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  resetIds('id');
  db = createTestDatabase();
  db.insert('visits', [visitRow({ id: 'v1', status: 'inProgress' })]);
  db.insert('annotations', [
    annotationRow({
      id: 'a1',
      visit_id: 'v1',
      elements: JSON.stringify([existing]),
      updated_at: OPENED_AT,
    }),
    annotationRow({ id: 'a2', visit_id: 'v1', updated_at: OPENED_AT }),
  ]);
  setTestDatabase(db);
});

afterEach(() => {
  setTestDatabase(null);
  jest.useRealTimers();
});

describe('useAnnotationEditor', () => {
  it('empieza con los elementos guardados y los valores por defecto', async () => {
    const { result } = await setup();

    expect(result.current.elements).toEqual([existing]);
    expect(result.current).toMatchObject({
      tool: ANNOTATION_DEFAULTS.tool,
      color: ANNOTATION_DEFAULTS.color,
      sizeId: ANNOTATION_DEFAULTS.size,
      snap: ANNOTATION_DEFAULTS.snap,
      selectedIds: [],
      canUndo: false,
      canRedo: false,
      isWritingText: false,
      autosaveStatus: 'idle',
    });
  });

  it('al abrir no guarda nada', async () => {
    await setup();
    const version = db.getVersion();

    await advance(5000);

    expect(db.getVersion()).toBe(version);
    expect(planRow()?.updated_at).toBe(OPENED_AT);
  });

  it('al dibujar guarda tras 1600 ms en la fila del plano (formato 2)', async () => {
    const { result } = await setup();

    await act(async () => result.current.draw(DRAG));
    expect(result.current.elements).toHaveLength(2);
    expect(result.current.elements[1]).toMatchObject({
      id: 'id-1',
      type: 'line',
      points: DRAG.points,
      color: ANNOTATION_DEFAULTS.color,
      strokeWidth: strokeSizeById('medium').strokeWidth,
    });

    await advance(1599);
    expect(storedElements()).toEqual([existing]);

    await advance(1);
    expect(storedElements()).toEqual(result.current.elements);
    expect(planRow()).toMatchObject({ format_version: 2, sync_status: 'pendingSync' });
    expect(planRow()?.updated_at).not.toBe(OPENED_AT);
    // El otro plano de la visita no cambia.
    expect(planRow('a2')?.updated_at).toBe(OPENED_AT);
    expect(result.current.autosaveStatus).toBe('saved');
  });

  it('cada cambio reinicia la espera del autoguardado', async () => {
    const { result } = await setup();

    await act(async () => result.current.draw(DRAG));
    await advance(1000);
    await act(async () => result.current.draw({ ...DRAG, points: [...DRAG.points].reverse() }));
    await advance(1000);
    expect(storedElements()).toHaveLength(1);

    await advance(600);
    expect(storedElements()).toHaveLength(3);
  });

  it('usa el color y el grosor elegidos; un gesto diminuto no crea nada', async () => {
    const { result } = await setup();

    await act(async () => {
      result.current.setColor(RED);
      result.current.setSizeId('thick');
      result.current.setSnap(false);
    });
    expect(result.current.size).toEqual(strokeSizeById('thick'));
    expect(result.current.snap).toBe(false);

    await act(async () => result.current.draw(DRAG));
    await act(async () =>
      result.current.draw({
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        scale: 1,
      }),
    );

    expect(result.current.elements).toHaveLength(2);
    expect(result.current.elements[1]).toMatchObject({ color: RED, strokeWidth: 6 });
  });

  it('con el texto abre el diálogo y añade el elemento al confirmar', async () => {
    const { result } = await setup();

    await act(async () => result.current.setTool('text'));
    await act(async () => result.current.draw({ points: [{ x: 30, y: 40 }], scale: 2 }));
    expect(result.current.isWritingText).toBe(true);
    expect(result.current.elements).toHaveLength(1);

    await act(async () => result.current.confirmText('  Rack 2 '));

    expect(result.current.isWritingText).toBe(false);
    // 18 px en pantalla con escala 2 → 9 cm.
    expect(result.current.elements[1]).toMatchObject({
      type: 'text',
      text: 'Rack 2',
      points: [{ x: 30, y: 40 }],
      fontSize: 9,
    });
  });

  it('cancelar el texto o confirmarlo vacío no añade nada', async () => {
    const { result } = await setup();

    await act(async () => result.current.setTool('text'));
    await act(async () => result.current.draw({ points: [{ x: 30, y: 40 }], scale: 1 }));
    await act(async () => result.current.cancelText());
    expect(result.current.isWritingText).toBe(false);
    // Sin texto pendiente, confirmar no hace nada.
    await act(async () => result.current.confirmText('Huérfano'));

    await act(async () => result.current.draw({ points: [{ x: 30, y: 40 }], scale: 1 }));
    await act(async () => result.current.confirmText('   '));

    expect(result.current.elements).toEqual([existing]);
    expect(result.current.canUndo).toBe(false);
  });

  it('borrar, deshacer y rehacer', async () => {
    const { result } = await setup();

    await act(async () => result.current.erase(['guardado']));
    expect(result.current.elements).toEqual([]);
    expect(result.current.canUndo).toBe(true);

    await act(async () => result.current.undo());
    expect(result.current.elements).toEqual([existing]);
    expect(result.current.canRedo).toBe(true);

    await act(async () => result.current.redo());
    expect(result.current.elements).toEqual([]);

    // Borrar nada no es un cambio.
    await act(async () => result.current.erase([]));
    await advance(1600);
    expect(storedElements()).toEqual([]);
  });

  it('seleccionar, mover, duplicar y borrar la selección', async () => {
    const { result } = await setup();

    await act(async () => result.current.setTool('select'));
    await act(async () => result.current.select(['guardado']));
    expect(result.current.selectedIds).toEqual(['guardado']);
    expect(result.current.selectedElements).toEqual([existing]);

    await act(async () => result.current.moveElements(['guardado'], 5, -5));
    expect(result.current.elements[0]?.points).toEqual([{ x: 15, y: 5 }]);
    // Mover nada no cambia nada.
    await act(async () => result.current.moveElements([], 5, 5));

    await act(async () => result.current.duplicateSelection(24));
    expect(result.current.elements).toHaveLength(2);
    expect(result.current.elements[1]).toMatchObject({ id: 'id-1', points: [{ x: 39, y: 29 }] });
    // La copia queda seleccionada.
    expect(result.current.selectedIds).toEqual(['id-1']);

    await act(async () => result.current.deleteSelection());
    expect(result.current.elements.map((element) => element.id)).toEqual(['guardado']);
    expect(result.current.selectedIds).toEqual([]);

    await advance(1600);
    expect(storedElements()).toEqual(result.current.elements);
  });

  it('la selección solo contiene elementos que existen y se vacía al cambiar de herramienta', async () => {
    const { result } = await setup();

    await act(async () => result.current.setTool('select'));
    await act(async () => result.current.select(['guardado', 'no-existe']));
    expect(result.current.selectedIds).toEqual(['guardado']);

    await act(async () => result.current.erase(['guardado']));
    expect(result.current.selectedIds).toEqual([]);
    await act(async () => result.current.undo());
    expect(result.current.selectedIds).toEqual(['guardado']);

    // Duplicar sin nada seleccionado no hace nada.
    await act(async () => result.current.clearSelection());
    await act(async () => result.current.duplicateSelection(24));
    expect(result.current.elements).toEqual([existing]);

    await act(async () => result.current.select(['guardado']));
    await act(async () => result.current.setTool('line'));
    expect(result.current.selectedIds).toEqual([]);
  });

  it('insertFigure la centra, la deja seleccionada y pasa a la herramienta de selección', async () => {
    const { result } = await setup();

    await act(async () => result.current.insertFigure(figure, { x: 500, y: 500 }));

    expect(result.current.tool).toBe('select');
    expect(result.current.elements).toHaveLength(3);
    expect(result.current.elements.slice(1)).toMatchObject([
      {
        id: 'id-1',
        points: [
          { x: 450, y: 400 },
          { x: 550, y: 600 },
        ],
      },
      { id: 'id-2', points: [{ x: 500, y: 500 }] },
    ]);
    expect(result.current.selectedIds).toEqual(['id-1', 'id-2']);

    // Una figura sin elementos no hace nada.
    await act(async () => result.current.insertFigure({ ...figure, elements: [] }, { x: 0, y: 0 }));
    expect(result.current.elements).toHaveLength(3);

    await act(async () => result.current.undo());
    expect(result.current.elements).toEqual([existing]);
    expect(result.current.selectedIds).toEqual([]);
  });

  it('guardar ahora guarda sin esperar', async () => {
    const { result } = await setup();

    await act(async () => result.current.draw(DRAG));
    await act(async () => result.current.saveNow());

    expect(storedElements()).toHaveLength(2);
    expect(result.current.autosaveStatus).toBe('saved');
  });

  it('si no se puede guardar avisa con el estado de error', async () => {
    db.insert('visits', [visitRow({ id: 'v-cerrada', status: 'completed' })]);
    const { result } = await setup({ visitId: 'v-cerrada' });

    await act(async () => result.current.draw(DRAG));
    await advance(1600);

    expect(result.current.autosaveStatus).toBe('error');
    expect(storedElements()).toEqual([existing]);
  });

  it('en solo lectura empieza con "mover vista" y nada cambia', async () => {
    const { result } = await setup({ readOnly: true });
    expect(result.current.tool).toBe('pan');

    await act(async () => {
      result.current.draw(DRAG);
      result.current.erase(['guardado']);
      result.current.select(['guardado']);
      result.current.moveElements(['guardado'], 10, 10);
      result.current.insertFigure(figure, { x: 0, y: 0 });
    });
    await act(async () => {
      result.current.duplicateSelection(24);
      result.current.deleteSelection();
      result.current.undo();
      result.current.redo();
      result.current.saveNow();
    });
    await act(async () => result.current.setTool('text'));
    await act(async () => result.current.draw({ points: [{ x: 1, y: 1 }], scale: 1 }));
    await act(async () => result.current.confirmText('No'));
    await advance(5000);

    expect(result.current.elements).toEqual([existing]);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.isWritingText).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(planRow()?.updated_at).toBe(OPENED_AT);
  });
});
