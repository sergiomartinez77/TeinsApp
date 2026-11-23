import type { GuideTopic } from '@/features/assistant/knowledge/guide';
import { visitTypeLabel, type Visit } from '@/models/visit.model';

import { hasPhrase, normalizeText, tokenize, wordsMatch } from '../text';

/**
 * Búsquedas tolerantes del asistente básico: materiales del catálogo, visitas
 * y temas de la guía. Comparan palabra por palabra sin tildes, en singular y
 * admitiendo errores de tecleo.
 */

export interface CatalogEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
}

/** Máximo de coincidencias que se devuelven. */
export const MAX_MATCHES = 6;

const isNumber = (word: string) => /^\d+$/.test(word);

/** ¿La palabra buscada coincide con una palabra del material o la visita? */
function matchesToken(word: string, token: string): boolean {
  // "20" encuentra "20a"; "16" encuentra "16mm".
  if (isNumber(word)) return token === word || (token.startsWith(word) && !isNumber(token));
  return wordsMatch(word, token);
}

const countMatched = (words: readonly string[], tokens: readonly string[]) =>
  words.filter((word) => tokens.some((token) => matchesToken(word, token))).length;

/**
 * Materiales que mejor coinciden con las palabras (por código o nombre).
 * Gana quien coincide con más palabras; un código escrito tal cual gana a todo.
 */
export function matchMaterials(
  words: readonly string[],
  catalog: readonly CatalogEntry[],
): CatalogEntry[] {
  if (words.length === 0) return [];
  const joined = words.join('');
  let best = 0;
  let matches: CatalogEntry[] = [];
  for (const entry of catalog) {
    const code = normalizeText(entry.code).replace(/ /g, '');
    const tokens = [...tokenize(entry.name), ...tokenize(entry.code), code];
    const score =
      code.length > 0 && (words.includes(code) || joined === code)
        ? 100
        : countMatched(words, tokens);
    if (score === 0 || score < best) continue;
    if (score > best) {
      best = score;
      matches = [];
    }
    matches.push(entry);
  }
  return matches.slice(0, MAX_MATCHES);
}

/** Palabras por las que se puede encontrar una visita. */
export function visitWords(visit: Visit): string[] {
  return [
    ...tokenize(visit.title),
    ...tokenize(visit.clientName ?? ''),
    ...tokenize(visit.address ?? ''),
    ...tokenize(visitTypeLabel(visit.visitType)),
  ];
}

/**
 * Visitas que coinciden con las palabras (cliente, título, dirección o tipo).
 * Una frase escrita tal cual en el cliente o el título gana; si no, las que
 * coinciden con más palabras (al menos la mitad).
 */
export function matchVisits(words: readonly string[], visits: readonly Visit[]): Visit[] {
  if (words.length === 0) return [];
  const phrase = words.join(' ');
  const exact = visits.filter(
    (visit) =>
      hasPhrase(normalizeText(visit.clientName ?? ''), phrase) ||
      hasPhrase(normalizeText(visit.title), phrase),
  );
  if (exact.length > 0) return exact;

  const needed = Math.ceil(words.length / 2);
  let best = 0;
  let matches: Visit[] = [];
  for (const visit of visits) {
    const score = countMatched(words, visitWords(visit));
    if (score < needed || score < best) continue;
    if (score > best) {
      best = score;
      matches = [];
    }
    matches.push(visit);
  }
  return matches;
}

/** Tema de la guía que mejor responde a la pregunta, o `null`. */
export function matchGuideTopic(text: string, topics: readonly GuideTopic[]): GuideTopic | null {
  const normalized = normalizeText(text);
  const words = tokenize(text);
  let best: GuideTopic | null = null;
  let bestScore = 0;
  for (const topic of topics) {
    let score = 0;
    for (const keyword of topic.keywords) {
      if (keyword.includes(' ')) {
        // La frase entera, o todas sus palabras aunque estén conjugadas o mal escritas.
        const parts = keyword.split(' ').filter((part) => part.length > 2);
        if (
          hasPhrase(normalized, keyword) ||
          parts.every((part) => words.some((word) => wordsMatch(word, part)))
        ) {
          score += 3;
        }
      } else if (words.some((word) => wordsMatch(word, keyword))) {
        score += 2;
      }
    }
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return best;
}
