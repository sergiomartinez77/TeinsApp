/**
 * Comparación de texto sin tildes ni mayúsculas para las herramientas del
 * asistente (misma idea que `src/features/assistant/services/text.ts`; se
 * repite aquí porque la función del servidor no puede importar código de la app).
 */

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ') : [];
}

const stem = (word: string) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);

/** ¿Iguales salvo dos letras vecinas intercambiadas ("cabel" / "cable")? */
function swappedNeighbors(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const diff = [...a].flatMap((letter, index) => (letter === b[index] ? [] : [index]));
  const [first, second] = diff;
  return (
    diff.length === 2 &&
    first !== undefined &&
    second === first + 1 &&
    a[first] === b[second] &&
    a[second] === b[first]
  );
}

/** ¿Difieren como máximo en una letra (cambio, inserción, borrado o dos vecinas cambiadas)? */
function oneEditApart(a: string, b: string): boolean {
  if (swappedNeighbors(a, b)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Palabra buscada contra palabra del dato: prefijo, singular o un error de tecleo. */
export function wordMatches(word: string, token: string): boolean {
  const a = stem(word);
  const b = stem(token);
  if (a === b || (word.length >= 3 && token.startsWith(word))) return true;
  return Math.min(a.length, b.length) >= 4 && oneEditApart(a, b);
}

/** ¿Todas las palabras buscadas aparecen en el texto? */
export function matchesAllWords(search: string, text: string): boolean {
  const words = tokenize(search);
  if (words.length === 0) return true;
  const tokens = tokenize(text);
  return words.every((word) => tokens.some((token) => wordMatches(word, token)));
}

/** Texto seguro para un filtro `ilike` de PostgREST (sin comodines ni separadores). */
export function sanitizeSearch(text: string, maxLength = 80): string {
  return text
    .replace(/[,()*%\\"':]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
