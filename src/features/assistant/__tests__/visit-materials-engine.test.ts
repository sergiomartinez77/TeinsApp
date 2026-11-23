import type { UserRole } from '@/models/user.model';
import {
  catalogRow,
  materialStockRow,
  TECH_A,
  TECH_B,
  visitMaterialRow,
  visitRow,
} from '@/test-utils/fixtures';
import { createTestDatabase, type TestDatabase } from '@/test-utils/test-database';

import type { AssistantAction, AssistantContext, AssistantReply } from '../services/engine';
import {
  answerVisitMaterialsChoice,
  createLocalEngine,
  detectIntent,
} from '../services/local-engine';
import { visitMaterialLine } from '../services/local-engine/visit-materials';

/**
 * Asistente básico: materiales de una visita, en qué visitas se usó un
 * material y "falta conteo inicial", con muchas formas de preguntar.
 */

jest.mock('@/utils/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { scopedLogger: () => log, logger: log };
});

// Domingo 22 de noviembre de 2026, 15:00 (hora local).
const NOW = new Date(2026, 10, 22, 15, 0, 0);
const local = (month: number, day: number, hour = 9) =>
  new Date(2026, month - 1, day, hour).toISOString();

let db: TestDatabase;

const context = (role: UserRole = 'technician'): AssistantContext => ({
  user: { id: TECH_A, role, fullName: null, email: 'tecnico@teins.com' },
  now: NOW,
});

const ask = (text: string, role: UserRole = 'technician'): Promise<AssistantReply> =>
  createLocalEngine(db).reply([], text, context(role));

const visitChoices = (actions: readonly AssistantAction[]) =>
  actions.flatMap((action) => (action.type === 'select_visit' ? [action] : []));

beforeEach(() => {
  db = createTestDatabase();
  db.insert('material_catalog', [
    catalogRow({
      id: 'm-cable',
      code: 'CAB-01',
      name: 'Cable UTP Cat6',
      unit: 'metro',
      min_stock: 100,
    }),
    catalogRow({
      id: 'm-abr',
      code: 'ABR-01',
      name: 'Abrazadera metálica',
      unit: 'unidad',
      min_stock: 10,
    }),
    catalogRow({ id: 'm-brk', code: 'BRK-20', name: 'Breaker 20A', unit: 'unidad', min_stock: 2 }),
  ]);
  db.insert('material_stock', [
    // Nunca se compró ni se ajustó: "−63" es solo el uso.
    materialStockRow({ material_id: 'm-cable', used: 63, on_hand: -63 }),
    materialStockRow({ material_id: 'm-abr', purchased: 20, used: 6, on_hand: 14 }),
    materialStockRow({ material_id: 'm-brk', purchased: 1, used: 2, on_hand: -1 }),
  ]);
  db.insert('profiles', [{ id: TECH_B, full_name: 'Luis Gómez', email: 'luis@teins.com' }]);
  db.insert('visits', [
    visitRow({
      id: 'v-perez',
      title: 'Cableado oficina',
      client_name: 'Ferretería Pérez',
      status: 'completed',
      created_at: local(11, 10),
      completed_at: local(11, 12),
    }),
    visitRow({
      id: 'v-colegio',
      title: 'Red del colegio',
      client_name: 'Colegio San José',
      status: 'inProgress',
      created_at: local(11, 21),
      started_at: local(11, 22, 8),
    }),
    visitRow({
      id: 'v-perez-2',
      title: 'Tablero',
      client_name: 'Casa Pérez',
      status: 'assigned',
      created_at: local(11, 1),
    }),
    visitRow({
      id: 'v-luis',
      technician_id: TECH_B,
      title: 'UPS',
      client_name: 'Banco Sur',
      status: 'completed',
      created_at: local(11, 15),
      completed_at: local(11, 15, 12),
    }),
  ]);
  db.insert('visit_materials', [
    visitMaterialRow({
      id: 'a',
      visit_id: 'v-perez',
      material_id: 'm-cable',
      material_code: 'CAB-01',
      material_name: 'Cable UTP Cat6',
      unit: 'metro',
      quantity: 40,
      sync_status: 'synced',
    }),
    visitMaterialRow({
      id: 'b',
      visit_id: 'v-perez',
      material_id: 'm-abr',
      material_code: 'ABR-01',
      material_name: 'Abrazadera metálica',
      unit: 'unidad',
      quantity: 6,
      sync_status: 'synced',
    }),
    visitMaterialRow({
      id: 'c',
      visit_id: 'v-colegio',
      material_id: 'm-cable',
      material_code: 'CAB-01',
      material_name: 'Cable UTP Cat6',
      unit: 'metro',
      quantity: 12.5,
    }),
    visitMaterialRow({
      id: 'd',
      visit_id: 'v-colegio',
      material_id: null,
      is_custom: 1,
      material_code: '',
      material_name: 'Canaleta especial',
      unit: 'metro',
      quantity: 3,
    }),
    visitMaterialRow({
      id: 'e',
      visit_id: 'v-luis',
      material_id: 'm-cable',
      material_code: 'CAB-01',
      material_name: 'Cable UTP Cat6',
      unit: 'metro',
      quantity: 10.5,
    }),
  ]);
});

describe('detección', () => {
  it.each([
    ['¿cuánto cable necesité en la visita de Pérez?', ['cable'], ['perez'], null],
    ['cuantas abrazaderas use en la ultima visita', ['abrazaderas'], [], 'latest'],
    ['materiales de la visita de hoy', [], [], 'today'],
    ['¿Qué materiales usé en la visita del colegio?', [], ['colegio'], null],
    ['cuánto material se gastó en la visita de ayer', [], [], 'yesterday'],
    [
      'Cuánto CABLE puse en la visita de Ferretería Pérez',
      ['cable'],
      ['ferreteria', 'perez'],
      null,
    ],
    ['qué llevé a la visita del banco', [], ['banco'], null],
    ['¿cuántos metros de cable instalamos en la visita reciente?', ['cable'], [], 'latest'],
  ])('«%s»', (text, materialWords, visitWords, reference) => {
    expect(detectIntent(text)).toEqual({
      kind: 'visit_materials',
      materialWords,
      visitWords,
      reference,
    });
  });

  it.each([
    ['¿En qué visitas se usó cable?', ['cable']],
    ['en cuales visitas usamos abrazaderas', ['abrazaderas']],
    ['¿En cuántas visitas se ocupó breaker?', ['breaker']],
    ['qué visitas usaron CAB-01', ['cab', '01']],
  ])('«%s» → en qué visitas', (text, words) => {
    expect(detectIntent(text)).toEqual({ kind: 'material_visits', words });
  });

  it.each([
    ['¿Cuántas visitas tengo pendientes?', 'visits'],
    ['visitas de hoy', 'visits'],
    ['PDF de la visita de Pérez', 'pdf'],
    ['¿Cuánto cable se consumió este mes?', 'consumption'],
    ['cuánto material se gastó en las visitas de esta semana', 'consumption'],
  ])('«%s» no cambia de tipo', (text, kind) => {
    expect(detectIntent(text).kind).toBe(kind);
  });
});

describe('materiales de una visita', () => {
  it('material concreto en la visita nombrada (con tildes, mayúsculas o errores)', async () => {
    for (const question of [
      '¿Cuánto cable necesité en la visita de Ferretería Pérez?',
      'cuanto CABEL use en la visita de ferreteria perez',
      'En la visita de Ferretería Pérez, ¿cuánto cable usé?',
    ]) {
      const reply = await ask(question);
      expect(reply.text).toContain('Ferretería Pérez — Cableado oficina');
      expect(reply.text).toContain('• Cable UTP Cat6 (CAB-01): 40 metro');
      expect(reply.text).not.toContain('Abrazadera');
    }
  });

  it('varias visitas coinciden → chips para elegir; al elegir, la respuesta', async () => {
    const reply = await ask('¿cuánto cable usé en la visita de Pérez?');
    expect(reply.text).toMatch(/Encontré 2 visitas que coinciden/);
    const choices = visitChoices(reply.actions);
    expect(choices.map((choice) => choice.visitId)).toEqual(['v-perez', 'v-perez-2']);
    expect(choices[0]).toMatchObject({ purpose: 'materials', query: 'cable' });

    const answer = await answerVisitMaterialsChoice(db, context(), 'v-perez', 'cable');
    expect(answer.text).toContain('• Cable UTP Cat6 (CAB-01): 40 metro');
    const empty = await answerVisitMaterialsChoice(db, context(), 'v-perez-2');
    expect(empty.text).toContain('no tiene materiales registrados');
    const gone = await answerVisitMaterialsChoice(db, context(), 'no-existe');
    expect(gone.text).toContain('ya no está en este teléfono');
  });

  it('la última visita, la de hoy y la de ayer', async () => {
    const latest = await ask('cuántas abrazaderas usé en la última visita');
    // La más reciente es la del colegio: no tiene abrazaderas, se listan las que sí.
    expect(latest.text).toContain('En la visita Colegio San José — Red del colegio');
    expect(latest.text).toContain('no se registró «abrazaderas»');
    expect(latest.text).toContain('Canaleta especial: 3 metro — personalizado');

    const today = await ask('materiales de la visita de hoy');
    expect(today.text).toContain('Materiales registrados en la visita Colegio San José');
    expect(today.text).toContain('• Cable UTP Cat6 (CAB-01): 12,5 metro');
    expect(today.text).toContain('aún sin sincronizar');

    // Ayer se creó la del colegio.
    const yesterday = await ask('¿qué materiales usé en la visita de ayer?');
    expect(yesterday.text).toContain('Materiales registrados en la visita Colegio San José');

    const none = await ask('materiales de la visita de Pérez de hoy');
    expect(none.text).toMatch(/No encontré visitas que coincidan con «perez» y con actividad hoy/);
    expect(visitChoices(none.actions).length).toBeGreaterThan(0);
  });

  it('todas las líneas de la visita (personalizados marcados) y visita sin nombrar', async () => {
    const all = await ask('¿Qué materiales usé en la visita del colegio?');
    expect(all.text).toContain('(en progreso)');
    expect(all.text).toContain('• Cable UTP Cat6 (CAB-01): 12,5 metro');
    expect(all.text).toContain('• Canaleta especial: 3 metro — personalizado');

    const which = await ask('¿cuánto cable usé en la visita?');
    expect(which.text).toMatch(/¿De qué visita\?/);
    expect(visitChoices(which.actions)[0]).toMatchObject({ purpose: 'materials', query: 'cable' });

    const missing = await ask('materiales de la visita de Marte');
    expect(missing.text).toContain('No encontré visitas que coincidan con «marte»');
  });

  it('técnico: no ve la visita de otro; admin y oficina sí', async () => {
    const tech = await ask('materiales de la visita del Banco Sur');
    expect(tech.text).toContain('No encontré visitas');
    for (const role of ['admin', 'office'] as const) {
      const reply = await ask('materiales de la visita del Banco Sur', role);
      expect(reply.text).toContain('• Cable UTP Cat6 (CAB-01): 10,5 metro');
    }
  });

  it('formato de línea', () => {
    expect(
      visitMaterialLine({
        id: 'x',
        visitId: 'v',
        materialId: null,
        isCustom: false,
        materialCode: '',
        materialName: 'Tubo',
        unit: '',
        quantity: 2,
        observations: null,
        syncStatus: 'synced',
        createdAt: '',
        updatedAt: '',
      }),
    ).toBe('Tubo: 2');
  });
});

describe('en qué visitas se usó un material', () => {
  it('una línea por visita (sin sumar entre visitas), la más reciente primero', async () => {
    const reply = await ask('¿En qué visitas se usó cable?');
    // Cuenta las visitas guardadas en el teléfono (en el de un técnico solo
    // estarían las suyas; aquí la base de prueba tiene también la de Luis).
    expect(reply.text).toContain('«Cable UTP Cat6» se usó en 3 visitas (total 63 metro)');
    const lines = reply.text.split('\n').filter((line) => line.startsWith('•'));
    expect(lines).toEqual([
      expect.stringMatching(
        /^• Colegio San José — Red del colegio \(.+\) · En progreso: 12,5 metro$/,
      ),
      expect.stringMatching(/^• Banco Sur — UPS \(.+\) · Completada · Luis Gómez: 10,5 metro$/),
      expect.stringMatching(
        /^• Ferretería Pérez — Cableado oficina \(.+\) · Completada: 40 metro$/,
      ),
    ]);
    expect(reply.actions).toEqual([{ type: 'open_inventory' }]);

    const admin = await ask('en cuales visitas usamos cable utp', 'admin');
    expect(admin.text).toContain('se usó en 3 visitas (total 63 metro)');
    expect(admin.text).toContain('· Luis Gómez: 10,5 metro');
  });

  it('sin material, no encontrado, varios o sin uso', async () => {
    expect((await ask('¿en qué visitas se usó?')).text).toContain('¿De qué material?');
    expect((await ask('¿en qué visitas se usó dinamita?')).text).toContain(
      'No encontré «dinamita»',
    );
    const several = await ask('¿en qué visitas se usó 01?');
    expect(several.text).toMatch(/Encontré \d materiales/);
    expect(several.actions.every((action) => action.type === 'suggestion')).toBe(true);
    expect((await ask('¿en qué visitas se usó breaker?')).text).toContain(
      'no se usó en las visitas',
    );
  });
});

describe('falta conteo inicial y stock negativo', () => {
  it('existencias: no dice "-63"; explica el conteo y lo usado', async () => {
    const reply = await ask('¿cuánto cable queda?');
    expect(reply.text).toContain('falta el conteo inicial');
    expect(reply.text).toContain('Usado en visitas: 63 metro');
    expect(reply.text).not.toMatch(/-63|−63/);
    expect((await ask('¿cuánto breaker hay?')).text).toContain('Stock negativo: revisa el conteo');
    expect((await ask('¿cuánto stock hay en bodega?')).text).toContain(
      '1 material usado no tiene conteo inicial (sin compras ni ajustes): Cable UTP Cat6.',
    );
  });

  it('qué comprar: no lo sugiere, lo lista aparte', async () => {
    const reply = await ask('¿Qué tengo que comprar?');
    expect(reply.text).toContain('Breaker 20A (BRK-20): comprar 3 unidad');
    expect(reply.text).not.toMatch(/Cable UTP Cat6 \(CAB-01\): comprar/);
    expect(reply.text).toContain('Sin conteo inicial');
    expect(reply.text).toContain('Cable UTP Cat6 (CAB-01): usado en visitas 63 metro');
  });
});

describe('visitas de admin y oficina', () => {
  it('listan las de todos con el técnico; el técnico solo las suyas', async () => {
    const admin = await ask('visitas completadas', 'admin');
    expect(admin.text).toMatch(/^Hay 2 visitas completadas/);
    expect(admin.text).toContain('Banco Sur — UPS');
    expect(admin.text).toContain('· Luis Gómez');
    const tech = await ask('visitas completadas');
    expect(tech.text).toMatch(/^Tienes 1 visita completadas/);
    expect(tech.text).not.toContain('Banco Sur');
    const pending = await ask('¿qué visitas hay pendientes?', 'office');
    expect(pending.text).toMatch(/^Hay 2 visitas pendientes/);
  });
});
