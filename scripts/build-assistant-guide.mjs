#!/usr/bin/env node
/**
 * Genera supabase/functions/assistant/guide.json a partir de la guía del
 * asistente (src/features/assistant/knowledge/guide.ts), que es la única
 * fuente de verdad.
 *
 *   npm run assistant:guide
 *
 * Node 22.18+ / 24 carga los archivos .ts directamente (quita los tipos), por
 * eso la guía y su exportación no usan alias `@/` ni sintaxis que no se pueda
 * borrar sin compilar. Un test (guide-sync.test.ts) falla si el JSON quedó
 * desactualizado.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { GUIDE_TOPICS } = await import('../src/features/assistant/knowledge/guide.ts');
const { GUIDE_JSON_PATH, serializeGuideJson } =
  await import('../src/features/assistant/knowledge/guide-export.ts');

const target = resolve(ROOT, GUIDE_JSON_PATH);
writeFileSync(target, serializeGuideJson(GUIDE_TOPICS), 'utf8');
process.stdout.write(
  `Guía del asistente escrita en ${GUIDE_JSON_PATH} (${GUIDE_TOPICS.length} temas).\n`,
);
