/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GUIDE_TOPICS } from '../knowledge/guide';
import { buildGuideJson, GUIDE_JSON_PATH, serializeGuideJson } from '../knowledge/guide-export';

/**
 * La guía tiene una sola fuente (knowledge/guide.ts). La función del servidor
 * usa una copia JSON: si este test falla, ejecuta `npm run assistant:guide`.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');

it('supabase/functions/assistant/guide.json está al día con la guía', () => {
  const file = readFileSync(join(ROOT, GUIDE_JSON_PATH), 'utf8');
  expect(JSON.parse(file)).toEqual(buildGuideJson(GUIDE_TOPICS));
});

it('el script escribe JSON legible con salto de línea final', () => {
  const text = serializeGuideJson(GUIDE_TOPICS);
  expect(text.endsWith('}\n')).toBe(true);
  expect(JSON.parse(text)).toEqual(buildGuideJson(GUIDE_TOPICS));
});

it('cada tema es completo y sus ids son únicos', () => {
  const ids = GUIDE_TOPICS.map((topic) => topic.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const topic of GUIDE_TOPICS) {
    expect(topic.title.trim()).not.toBe('');
    expect(topic.steps.length).toBeGreaterThan(0);
    // Las palabras clave se comparan ya normalizadas (sin tildes, minúsculas).
    for (const keyword of topic.keywords) {
      expect(keyword).toBe(keyword.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
    }
  }
  // Cubre los temas pedidos para el asistente.
  expect(ids).toEqual(
    expect.arrayContaining([
      'iniciar-sesion',
      'crear-visita',
      'iniciar-completar-visita',
      'formularios',
      'fotos',
      'materiales',
      'planos',
      'inventario',
      'pdf',
      'sincronizacion',
      'asistente',
    ]),
  );
});
