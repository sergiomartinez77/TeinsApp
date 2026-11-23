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

import { GUIDE_TOPICS } from '../knowledge/guide';
import type { AssistantAction, AssistantContext, AssistantReply } from '../services/engine';
import { answerVisitChoice, createLocalEngine, detectIntent } from '../services/local-engine';
import { formatGuideTopic, LOCAL_MESSAGES } from '../services/local-engine/handlers';
import { matchGuideTopic, matchMaterials } from '../services/local-engine/match';

/**
 * Asistente básico sobre SQLite real: cada respuesta sale de las APIs de
 * inventario e informes con los datos sembrados. Muchas formas de preguntar
 * (tildes, mayúsculas, errores de tecleo).
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

function context(role: UserRole = 'technician'): AssistantContext {
  return { user: { id: TECH_A, role, fullName: null, email: 'tecnico@teins.com' }, now: NOW };
}

const ask = (text: string, role: UserRole = 'technician'): Promise<AssistantReply> =>
  createLocalEngine(db).reply([], text, context(role));

const types = (actions: readonly AssistantAction[]) => actions.map((action) => action.type);

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
      id: 'm-breaker',
      code: 'BRK-20',
      name: 'Breaker 20A',
      unit: 'unidad',
      min_stock: 5,
    }),
    catalogRow({
      id: 'm-rj45',
      code: 'RJ-45',
      name: 'Conector RJ45',
      unit: 'unidad',
      min_stock: null,
    }),
    catalogRow({
      id: 'm-cinta',
      code: 'CIN-01',
      name: 'Cinta aislante',
      unit: 'rollo',
      min_stock: 3,
    }),
    catalogRow({
      id: 'm-viejo',
      code: 'OLD-01',
      name: 'Cable antiguo',
      unit: 'metro',
      is_active: 0,
    }),
  ]);
  db.insert('material_stock', [
    materialStockRow({ material_id: 'm-cable', purchased: 120, used: 70.5, on_hand: 49.5 }),
    materialStockRow({ material_id: 'm-breaker', purchased: 10, adjusted: -1, on_hand: 9 }),
    materialStockRow({ material_id: 'm-rj45', purchased: 200, on_hand: 200 }),
  ]);
  db.insert('visits', [
    visitRow({
      id: 'v-clinica',
      title: 'Revisión de red',
      client_name: 'Clínica Ñandú Sur',
      status: 'inProgress',
      created_at: local(11, 22, 8),
      started_at: local(11, 22, 9),
    }),
    visitRow({
      id: 'v-banco',
      title: 'Tablero principal',
      client_name: 'Banco Central',
      status: 'assigned',
      created_at: local(11, 20),
    }),
    visitRow({
      id: 'v-banco-oct',
      title: 'UPS sala de servidores',
      client_name: 'Banco Central',
      status: 'completed',
      created_at: local(10, 14),
      started_at: local(10, 15, 8),
      completed_at: local(10, 15, 12),
    }),
    visitRow({
      id: 'v-ajena',
      technician_id: TECH_B,
      client_name: 'Clínica Ñandú Sur',
      created_at: local(11, 22),
    }),
  ]);
  db.insert('visit_materials', [
    visitMaterialRow({
      id: 'vm1',
      visit_id: 'v-clinica',
      material_id: 'm-cable',
      material_code: 'CAB-01',
      material_name: 'Cable UTP Cat6',
      unit: 'metro',
      quantity: 12.5,
    }),
    visitMaterialRow({
      id: 'vm2',
      visit_id: 'v-clinica',
      material_id: 'm-breaker',
      material_code: 'BRK-20',
      material_name: 'Breaker 20A',
      quantity: 2,
    }),
    visitMaterialRow({
      id: 'vm3',
      visit_id: 'v-clinica',
      material_id: null,
      is_custom: 1,
      material_code: 'PERSONALIZADO',
      material_name: 'Abrazadera',
      unit: 'caja',
      quantity: 1,
    }),
    visitMaterialRow({
      id: 'vm4',
      visit_id: 'v-banco-oct',
      material_id: 'm-cable',
      material_code: 'CAB-01',
      material_name: 'Cable UTP Cat6',
      unit: 'metro',
      quantity: 30,
      sync_status: 'synced',
    }),
  ]);
});

describe('existencias de un material', () => {
  const cableLine =
    'Cable UTP Cat6 (CAB-01): 49,5 metro en bodega; mínimo 100 metro. Está bajo mínimo: conviene comprar 51 metro.';

  it.each([
    '¿Cuánto cable me queda?',
    'cuanto CABLE queda',
    'cuánto cabel hay en bodega', // error de tecleo
    'stock del CAB-01',
    'existencias de cables utp',
    'cable utp', // sin palabra clave: se reconoce el material
  ])('«%s»', async (question) => {
    const reply = await ask(question);
    expect(reply.engine).toBe('local');
    expect(reply.text).toContain(cableLine);
    expect(reply.text).toContain('Hay cambios de este teléfono aún sin sincronizar.');
    expect(reply.text).toContain(LOCAL_MESSAGES.syncNote);
    expect(types(reply.actions)).toEqual(['open_inventory']);
  });

  it('material sin bajo mínimo, sin mínimo y sin existencias', async () => {
    expect((await ask('¿cuántos breakers hay?')).text).toContain(
      'Breaker 20A (BRK-20): 9 unidad en bodega; mínimo 5 unidad.',
    );
    expect((await ask('cuantos conectores rj45 quedan')).text).toContain(
      'Conector RJ45 (RJ-45): 200 unidad en bodega; sin mínimo definido.',
    );
    expect((await ask('cinta aislante')).text).toContain(
      'Cinta aislante (CIN-01): todavía no llegaron sus existencias a este teléfono',
    );
  });

  it('varias coincidencias y ninguna (los inactivos no cuentan)', async () => {
    const both = await ask('stock de material uno y breaker');
    expect(both.text).toContain('Breaker 20A');
    const none = await ask('¿cuánto pegamento queda?');
    expect(none.text).toContain('No encontré «pegamento» en el catálogo de materiales.');
    expect(matchMaterials(['antiguo'], [])).toEqual([]);
    const several = await ask('stock de cable conector');
    expect(several.text).toMatch(
      /Encontré 2 materiales que coinciden:\n• Cable UTP Cat6[\s\S]*• Conector RJ45/,
    );
  });

  it('resumen general', async () => {
    const reply = await ask('¿Cuánto stock hay en bodega?');
    expect(reply.text).toContain('Hay 4 materiales activos en el catálogo; 1 está bajo mínimo.');
    expect(reply.text).toContain('• Cable UTP Cat6 (CAB-01): 49,5 metro');
    expect(reply.text).toContain('1 material aún no tiene existencias en el teléfono.');
    expect(types(reply.actions)).toEqual(['open_inventory']);
  });

  it('catálogo vacío', async () => {
    db = createTestDatabase();
    expect((await ask('inventario')).text).toContain('Aún no hay materiales del catálogo');
  });
});

describe('qué comprar', () => {
  it.each([
    '¿Qué tengo que comprar?',
    'que falta en bodega',
    'materiales bajo minimo',
    'qué hay que reponer',
    'Qe hay que comprr',
  ])('«%s»', async (question) => {
    const reply = await ask(question);
    expect(reply.text).toContain('Para volver al mínimo conviene comprar:');
    expect(reply.text).toContain(
      '• Cable UTP Cat6 (CAB-01): comprar 51 metro (hay 49,5 metro; mínimo 100 metro)',
    );
    expect(reply.text).not.toContain('Breaker');
    expect(reply.text).toContain('1 material no tiene mínimo definido y no se evalúan.');
  });

  it('mínimo de un material concreto y nada por comprar', async () => {
    expect((await ask('¿cuál es el mínimo del breaker?')).text).toContain('mínimo 5 unidad');
    db.raw.exec("UPDATE material_stock SET on_hand = 150 WHERE material_id = 'm-cable'");
    expect((await ask('qué comprar')).text).toContain('Nada por comprar');
  });
});

describe('consumo', () => {
  it('hoy, por defecto este mes y por material', async () => {
    const today = await ask('¿Cuánto material se consumió hoy?');
    expect(today.text).toContain(
      'Consumo de materiales del catálogo hoy (22 de noviembre de 2026):',
    );
    expect(today.text).toContain('• Cable UTP Cat6 (CAB-01): 12,5 metro en 1 visita');
    expect(today.text).toContain('• Breaker 20A (BRK-20): 2 unidad en 1 visita');
    expect(today.text).not.toContain('Abrazadera');
    expect(today.text).toContain(LOCAL_MESSAGES.deviceScope);

    expect((await ask('consumo')).text).toContain('Consumo de materiales del catálogo este mes:');
    const cable = await ask('cuánto cable usé el mes pasado');
    expect(cable.text).toContain('Consumo de «Cable UTP Cat6» el mes pasado (octubre de 2026):');
    expect(cable.text).toContain('30 metro en 1 visita');
  });

  it('rangos, sin consumo y material desconocido', async () => {
    expect((await ask('consumo del 1 al 15 de octubre')).text).toContain('30 metro');
    expect((await ask('consumo de ayer')).text).toContain(
      'No se registró consumo de materiales del catálogo ayer (21 de noviembre de 2026).',
    );
    expect((await ask('cuanto pegamento se gastó esta semana')).text).toContain(
      'No encontré «pegamento»',
    );
  });
});

describe('visitas', () => {
  it('pendientes (solo las del técnico; primero en progreso)', async () => {
    const reply = await ask('¿Qué visitas tengo pendientes?');
    expect(reply.text).toContain('Tienes 2 visitas pendientes (asignadas o en progreso):');
    const lines = reply.text.split('\n').filter((line) => line.startsWith('• '));
    expect(lines[0]).toContain('Clínica Ñandú Sur — Revisión de red');
    expect(lines[0]).toContain('En progreso');
    expect(lines[1]).toContain('Banco Central — Tablero principal');
    expect(reply.text).toContain('Por hacer: 1 en progreso y 1 asignada. Completadas: 1.');
    expect(types(reply.actions)).toEqual(['suggestion', 'suggestion']);
    expect((await ask('mis visitas')).text).toContain('Tienes 2 visitas pendientes');
  });

  it('de hoy, en curso, asignadas y completadas', async () => {
    expect((await ask('visitas de hoy')).text).toMatch(
      /Tienes 1 visita con actividad hoy[\s\S]*Clínica/,
    );
    expect((await ask('visitas en curso')).text).toMatch(
      /1 visita en progreso:[\s\S]*Revisión de red/,
    );
    expect((await ask('visitas asignadas')).text).toContain('Tablero principal');
    expect((await ask('visitas terminadas')).text).toContain('UPS sala de servidores');
  });

  it('por cliente, sin tildes y sin resultados', async () => {
    const banco = await ask('visitas del cliente banco central');
    expect(banco.text).toContain('Tienes 2 visitas que coinciden con «banco central»');
    expect((await ask('visitas de clinica nandu')).text).toContain('Tienes 1 visita');
    expect((await ask('visitas completadas del banco')).text).toContain('UPS sala de servidores');
    expect((await ask('visitas de ferreteria')).text).toContain('No encontré visitas');
  });

  it('sin visitas', async () => {
    db.raw.exec('DELETE FROM visits');
    expect((await ask('visitas pendientes')).text).toContain('No tienes visitas pendientes.');
    expect((await ask('visitas de hoy')).text).toContain('Hoy no hay visitas');
    expect((await ask('visitas completadas')).text).toBe('No tienes visitas completadas.');
    expect((await ask('pdf de una visita')).text).toContain('No hay visitas guardadas');
  });
});

describe('PDF de una visita', () => {
  it('una coincidencia → acción para compartir el PDF', async () => {
    for (const question of [
      'PDF de la visita de Clínica',
      'genera el informe de clinica nandu',
      'reporte de la visita revision de red',
    ]) {
      const reply = await ask(question);
      expect(reply.actions).toEqual([
        {
          type: 'share_pdf',
          visitId: 'v-clinica',
          label: expect.stringContaining('Clínica Ñandú Sur — Revisión de red'),
        },
      ]);
    }
  });

  it('varias coincidencias → elegir; sin texto → recientes; sin coincidencias', async () => {
    const many = await ask('quiero el informe del banco');
    expect(many.text).toContain('Encontré 2 visitas que coinciden con «banco»');
    expect(
      many.actions.map((action) => (action.type === 'select_visit' ? action.visitId : '')),
    ).toEqual(['v-banco', 'v-banco-oct']);
    const empty = await ask('pdf');
    expect(empty.text).toContain('¿De qué visita quieres el PDF?');
    expect(types(empty.actions)).toEqual(['select_visit', 'select_visit', 'select_visit']);
    const none = await ask('pdf de la ferretería');
    expect(none.text).toContain('No encontré visitas que coincidan con «ferreteria»');
  });

  it('elegir una visita de la lista', async () => {
    const chosen = await answerVisitChoice(db, context(), 'v-banco');
    expect(chosen.actions).toEqual([
      { type: 'share_pdf', visitId: 'v-banco', label: expect.stringContaining('Banco Central') },
    ]);
    expect((await answerVisitChoice(db, context(), 'v-ajena')).text).toContain('ya no está');
  });
});

describe('guía de uso', () => {
  it.each([
    ['¿Cómo tomo una foto?', 'fotos'],
    ['como agrego materiales a la visita', 'materiales'],
    ['¿Cómo se crea una nueva visita?', 'crear-visita'],
    ['como finalizo la visita', 'iniciar-completar-visita'],
    ['guía de planos', 'planos'],
    ['¿cómo saco el PDF?', 'pdf'],
    ['como trabajo sin internet', 'sincronizacion'],
    ['como lleno varios formularios', 'formularios'],
    ['¿cómo inicio sesión?', 'iniciar-sesion'],
  ])('«%s» → %s', (question, topicId) => {
    expect(detectIntent(question).kind).toBe('guide');
    expect(matchGuideTopic(question, GUIDE_TOPICS)?.id).toBe(topicId);
  });

  it('paso a paso con la nota del rol', async () => {
    const technician = await ask('¿Cómo registro una compra en el inventario?');
    expect(technician.text).toContain('Inventario de bodega');
    expect(technician.text).toContain('1. En el inicio toca «Inventario».');
    expect(technician.text).toContain('Como técnico puedes consultar existencias');
    const office = await ask('¿Cómo registro una compra en el inventario?', 'office');
    expect(office.text).toContain('Oficina puede registrar compras y ajustes');
    expect(types(office.actions)).toEqual(['suggestion', 'suggestion', 'suggestion']);
    const topic = GUIDE_TOPICS[0];
    expect(topic && formatGuideTopic(topic, 'client')).not.toContain('undefined');
  });

  it('sin tema concreto: lista de temas', async () => {
    const reply = await ask('¿Cómo uso la app?');
    expect(reply.actions).toHaveLength(GUIDE_TOPICS.length);
    expect((await ask('ayuda con el inventario')).text).toContain('Inventario de bodega');
  });
});

describe('saludo, ayuda y no entendido', () => {
  it('saludos, gracias y ayuda', async () => {
    expect((await ask('Hola')).text).toMatch(/^¡Hola! Puedo ayudarte con:/);
    expect((await ask('buenos días')).text).toMatch(/^¡Hola!/);
    expect((await ask('gracias!!')).text).toBe('¡De nada! ¿Te ayudo con algo más?');
    expect((await ask('¿Qué puedes hacer?')).text).toMatch(/^Puedo ayudarte con:/);
    expect((await ask('   ')).text).toMatch(/^Puedo ayudarte con:/);
    expect(types((await ask('abrir inventario')).actions)).toEqual(['open_inventory']);
  });

  it('pregunta desconocida: honesta y con sugerencias', async () => {
    const reply = await ask('xyzzy plugh');
    expect(reply.text).toBe(LOCAL_MESSAGES.notUnderstood);
    expect(reply.actions.length).toBeGreaterThan(3);
  });

  it('fallo de la base: lo dice y no inventa', async () => {
    const broken = {
      getAll: jest.fn(async () => {
        throw new Error('disco');
      }),
      getOptional: jest.fn(async () => {
        throw new Error('disco');
      }),
    };
    const engine = createLocalEngine(broken);
    for (const question of [
      'cuanto cable queda',
      'stock',
      'qué comprar',
      'consumo de hoy',
      'visitas pendientes',
      'visitas de banco',
      'pdf de banco',
      'cable utp',
    ]) {
      expect((await engine.reply([], question, context())).text).toBe(LOCAL_MESSAGES.databaseError);
    }
    expect((await answerVisitChoice(broken, context(), 'v1')).text).toBe(
      LOCAL_MESSAGES.databaseError,
    );
  });
});
