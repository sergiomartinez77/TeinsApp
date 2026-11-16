/** Consulta SQL con sus parámetros posicionales. */
export interface SqlQuery {
  sql: string;
  parameters: (string | number)[];
}

/** Escapa los comodines de LIKE para buscar el texto tal cual lo escribió el usuario. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Pasa a minúsculas solo las letras A–Z: así compara `LIKE` de SQLite. */
const foldAsciiCase = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** Primera letra de cada palabra en mayúscula y el resto en minúscula. */
const titleCase = (text: string) =>
  text.toLocaleLowerCase('es').replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => {
    return space + letter.toLocaleUpperCase('es');
  });

/**
 * Variantes de mayúsculas del texto buscado que `LIKE` necesita para ignorar
 * mayúsculas también en letras acentuadas.
 *
 * `LIKE` de SQLite solo ignora mayúsculas en A–Z: "ÉXITO" no encuentra
 * "éxito". Se busca además el texto en minúsculas, en mayúsculas y con
 * mayúscula inicial en cada palabra (como suelen escribirse nombres y
 * direcciones). Se descartan las variantes que solo difieren en A–Z, porque
 * `LIKE` ya las trata como iguales: un texto sin acentos da una sola variante.
 */
export function likeCaseVariants(text: string): string[] {
  const candidates = [
    text,
    text.toLocaleLowerCase('es'),
    text.toLocaleUpperCase('es'),
    titleCase(text),
  ];
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const candidate of candidates) {
    const key = foldAsciiCase(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(candidate);
  }
  return variants;
}

/**
 * Condición "alguna columna contiene el texto" con `LIKE`, ignorando
 * mayúsculas también en letras acentuadas. El texto va siempre como
 * parámetro y con los comodines escapados.
 */
export function containsAnyCondition(columns: readonly string[], search: string): SqlQuery {
  const patterns = likeCaseVariants(search).map((variant) => `%${escapeLike(variant)}%`);
  const conditions: string[] = [];
  const parameters: string[] = [];
  for (const column of columns) {
    for (const pattern of patterns) {
      conditions.push(`${column} LIKE ? ESCAPE '\\'`);
      parameters.push(pattern);
    }
  }
  return { sql: conditions.join(' OR '), parameters };
}
