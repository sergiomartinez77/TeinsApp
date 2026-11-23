import {
  catalogRow,
  materialStockRow,
  stockMovementRow,
  TECH_A,
  TECH_B,
  visitMaterialRow,
  visitRow,
} from '@/test-utils/fixtures';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

import {
  getLowStock,
  getMaterialStock,
  getMaterialsWithoutInitialCount,
  getMaterialUsageByVisit,
  getPurchaseSuggestions,
  getStockSummary,
  materialUsageFromRows,
} from '../services/inventory.service';

/**
 * "Falta conteo inicial" (materiales sin compras ni ajustes) y "Uso por
 * visita" contra SQLite real.
 */

jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

let db: TestDatabase;

beforeEach(() => {
  db = createTestDatabase();
  db.insert('material_catalog', [
    // Usado en visitas pero nunca comprado ni ajustado: −63 no es una existencia.
    catalogRow({ id: 'm-cable', code: 'CAB-01', name: 'Cable', unit: 'metro', min_stock: 100 }),
    // Con compras y negativo: inconsistencia (se usó más de lo que entró).
    catalogRow({ id: 'm-tornillo', code: 'TOR-01', name: 'Tornillo', min_stock: 2 }),
    // Con ajuste inicial (conteo) y bajo mínimo.
    catalogRow({ id: 'm-brida', code: 'BRI-01', name: 'Brida', min_stock: 10 }),
    // Sin uso, sin movimientos y sin mínimo: no importa para comprar.
    catalogRow({ id: 'm-nuevo', code: 'NEW-01', name: 'Nuevo', min_stock: null }),
    // Sin movimientos ni uso, pero con mínimo: sí se avisa.
    catalogRow({ id: 'm-cinta', code: 'CIN-01', name: 'Cinta', unit: 'rollo', min_stock: 3 }),
  ]);
  db.insert('material_stock', [
    materialStockRow({ material_id: 'm-cable', used: 63, on_hand: -63 }),
    materialStockRow({ material_id: 'm-tornillo', purchased: 5, used: 8, on_hand: -3 }),
    materialStockRow({ material_id: 'm-brida', adjusted: 4, on_hand: 4 }),
    materialStockRow({ material_id: 'm-nuevo' }),
    materialStockRow({ material_id: 'm-cinta' }),
  ]);
});

describe('falta conteo inicial', () => {
  it('marca los materiales sin compras ni ajustes y no los da por bajo mínimo', async () => {
    const cable = await getMaterialStock(db, 'm-cable');
    expect(cable).toMatchObject({
      needsInitialCount: true,
      isNegative: false,
      isLow: false,
      stock: { purchased: 0, adjusted: 0, used: 63, onHand: -63 },
    });
    expect(await getMaterialStock(db, 'm-tornillo')).toMatchObject({
      needsInitialCount: false,
      isNegative: true,
      isLow: true,
    });
    expect(await getMaterialStock(db, 'm-brida')).toMatchObject({
      needsInitialCount: false,
      isNegative: false,
      isLow: true,
    });
  });

  it('"Qué comprar" no los sugiere: van aparte (solo si se usan o tienen mínimo)', async () => {
    const low = await getLowStock(db);
    expect(low.map((item) => item.materialId).sort()).toEqual(['m-brida', 'm-tornillo']);
    const suggestions = await getPurchaseSuggestions(db);
    expect(
      suggestions.map((suggestion) => [suggestion.item.materialId, suggestion.suggestedQuantity]),
    ).toEqual([
      ['m-brida', 6],
      ['m-tornillo', 5],
    ]);
    const uncounted = await getMaterialsWithoutInitialCount(db);
    expect(uncounted.map((item) => item.materialId)).toEqual(['m-cable', 'm-cinta']);
  });

  it('en cuanto hay un movimiento sincronizado, se muestra en bodega normalmente', async () => {
    db.insert('material_stock_movements', [
      stockMovementRow({
        id: 'mv-conteo',
        material_id: 'm-cable',
        kind: 'adjustment',
        quantity: 80,
      }),
    ]);
    // El servidor recalcula: ajuste 80 − uso 63 = 17.
    db.raw
      .prepare(
        "UPDATE material_stock SET adjusted = 80, on_hand = 17 WHERE material_id = 'm-cable'",
      )
      .run();
    expect(await getMaterialStock(db, 'm-cable')).toMatchObject({
      needsInitialCount: false,
      isLow: true,
      stock: { onHand: 17 },
    });
    expect((await getMaterialsWithoutInitialCount(db)).map((item) => item.materialId)).toEqual([
      'm-cinta',
    ]);
  });

  it('el resumen los ordena después de los bajo mínimo', async () => {
    const items = await getStockSummary(db);
    expect(items.slice(0, 2).map((item) => item.materialId)).toEqual(['m-brida', 'm-tornillo']);
  });
});

describe('getMaterialUsageByVisit', () => {
  beforeEach(() => {
    db.insert('profiles', [{ id: TECH_B, full_name: 'Luis Gómez', email: 'luis@teins.com' }]);
    db.insert('visits', [
      visitRow({
        id: 'v-vieja',
        title: 'Tablero',
        client_name: 'Pérez',
        status: 'completed',
        created_at: '2026-06-01T08:00:00.000Z',
        completed_at: '2026-06-02T10:00:00.000Z',
      }),
      visitRow({
        id: 'v-nueva',
        title: 'Red',
        client_name: 'Colegio',
        status: 'inProgress',
        created_at: '2026-06-05T08:00:00.000Z',
      }),
      visitRow({
        id: 'v-ajena',
        technician_id: TECH_B,
        title: 'Cableado',
        client_name: null,
        status: 'assigned',
        created_at: '2026-06-03T08:00:00.000Z',
      }),
    ]);
    db.insert('visit_materials', [
      visitMaterialRow({
        id: 'a',
        visit_id: 'v-vieja',
        material_id: 'm-cable',
        unit: 'metro',
        quantity: 40,
      }),
      visitMaterialRow({
        id: 'b',
        visit_id: 'v-nueva',
        material_id: 'm-cable',
        unit: 'metro',
        quantity: 12.5,
      }),
      // Dos líneas del mismo material en la misma visita: se suman en ESA visita.
      visitMaterialRow({
        id: 'c',
        visit_id: 'v-nueva',
        material_id: 'm-cable',
        unit: 'metro',
        quantity: 0.5,
      }),
      visitMaterialRow({
        id: 'd',
        visit_id: 'v-ajena',
        material_id: 'm-cable',
        unit: 'metro',
        quantity: 10,
      }),
      // Personalizado con el mismo id: no es de bodega.
      visitMaterialRow({
        id: 'e',
        visit_id: 'v-vieja',
        material_id: 'm-cable',
        is_custom: 1,
        quantity: 99,
      }),
      visitMaterialRow({ id: 'f', visit_id: 'v-vieja', material_id: 'm-brida', quantity: 3 }),
    ]);
  });

  it('una fila por visita, la más reciente primero, con el total de todas', async () => {
    const usage = await getMaterialUsageByVisit(db, 'm-cable');
    expect(usage).toMatchObject({ materialId: 'm-cable', total: 63, visitCount: 3 });
    expect(usage.visits).toEqual([
      {
        visitId: 'v-nueva',
        title: 'Red',
        clientName: 'Colegio',
        status: 'inProgress',
        date: '2026-06-05T08:00:00.000Z',
        technicianId: TECH_A,
        technicianName: null,
        quantity: 13,
        unit: 'metro',
      },
      expect.objectContaining({
        visitId: 'v-ajena',
        technicianName: 'Luis Gómez',
        quantity: 10,
        status: 'assigned',
      }),
      expect.objectContaining({
        visitId: 'v-vieja',
        date: '2026-06-02T10:00:00.000Z',
        quantity: 40,
        status: 'completed',
      }),
    ]);
  });

  it('el límite recorta la lista pero no el total; sin uso, vacío', async () => {
    const usage = await getMaterialUsageByVisit(db, 'm-cable', { limit: 1 });
    expect(usage.visits.map((visit) => visit.visitId)).toEqual(['v-nueva']);
    expect(usage).toMatchObject({ total: 63, visitCount: 3 });
    expect(await getMaterialUsageByVisit(db, 'm-nuevo')).toEqual({
      materialId: 'm-nuevo',
      total: 0,
      visitCount: 0,
      visits: [],
    });
    expect(materialUsageFromRows('x', [], { total: 'NaN', visit_count: 'x' })).toEqual({
      materialId: 'x',
      total: 0,
      visitCount: 0,
      visits: [],
    });
  });
});
