/**
 * Texto del asistente básico: normalización y comparación tolerante.
 *
 * Todo se compara sin tildes, en minúsculas y sin signos, de modo que
 * «¿Cuánto CABLE me queda?» y «cuanto cable me queda» son lo mismo. Las
 * faltas de ortografía se toleran con la distancia de edición (una letra en
 * palabras de 4 a 6 letras, dos en palabras más largas).
 */

/** Sin tildes ni diéresis (la ñ se conserva como n), minúsculas y espacios simples. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Palabras del texto normalizado. */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ') : [];
}

/**
 * Formas posibles en singular ("cables" → cable; "conectores" → conectore y
 * conector). Se prueban todas porque en español el plural suma "s" o "es".
 */
export function singularForms(word: string): string[] {
  const forms = [word];
  if (word.length > 3 && word.endsWith('s')) forms.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith('es')) forms.push(word.slice(0, -2));
  return forms;
}

/** Forma singular más probable (solo quita la "s" final). */
export function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * Distancia de edición con transposiciones ("cabel" → "cable" cuenta 1), con
 * un tope: devuelve `max + 1` si la supera.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (beforePrevious[j - 2] ?? 0) + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    beforePrevious = previous;
    previous = current;
  }
  return Math.min(previous[b.length] ?? max + 1, max + 1);
}

/** Errores de tecleo admitidos según el largo de la palabra. */
export function allowedTypos(length: number): number {
  if (length >= 7) return 2;
  if (length >= 4) return 1;
  return 0;
}

/** ¿Dos palabras son "la misma" (singular, con tolerancia a errores de tecleo)? */
export function wordsMatch(word: string, target: string): boolean {
  const targets = singularForms(target);
  if (singularForms(word).some((form) => targets.includes(form))) return true;
  const a = singular(word);
  const b = singular(target);
  const typos = allowedTypos(Math.min(a.length, b.length));
  return typos > 0 && editDistance(a, b, typos) <= typos;
}

/** ¿Alguna palabra coincide con alguna de las palabras clave? */
export function hasAnyWord(words: readonly string[], keywords: readonly string[]): boolean {
  return words.some((word) => keywords.some((keyword) => wordsMatch(word, keyword)));
}

/** ¿El texto normalizado contiene la frase (también normalizada) como palabras completas? */
export function hasPhrase(normalized: string, phrase: string): boolean {
  return ` ${normalized} `.includes(` ${normalizeText(phrase)} `);
}

/** Palabras que no aportan a una búsqueda (artículos, preposiciones, verbos de relleno). */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'al',
  'algo',
  'aun',
  'con',
  'cual',
  'cuales',
  'de',
  'del',
  'dime',
  'el',
  'en',
  'es',
  'esta',
  'este',
  'favor',
  'hay',
  'la',
  'las',
  'le',
  'lo',
  'los',
  'me',
  'mi',
  'mis',
  'muestrame',
  'necesito',
  'no',
  'nos',
  'o',
  'para',
  'por',
  'porfa',
  'porfavor',
  'puedes',
  'que',
  'quiero',
  'se',
  'si',
  'sobre',
  'su',
  'sus',
  'te',
  'tengo',
  'tenemos',
  'tiene',
  'todo',
  'todos',
  'tu',
  'un',
  'una',
  'unas',
  'unos',
  'y',
  'ya',
]);

/** Palabras con contenido: sin las de relleno ni las indicadas. */
export function contentWords(
  words: readonly string[],
  extraIgnored: readonly string[] = [],
): string[] {
  return words.filter(
    (word) => !STOPWORDS.has(word) && !extraIgnored.some((ignored) => wordsMatch(word, ignored)),
  );
}
