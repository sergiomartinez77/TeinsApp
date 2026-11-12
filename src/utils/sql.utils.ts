/** Consulta SQL con sus parámetros posicionales. */
export interface SqlQuery {
  sql: string;
  parameters: (string | number)[];
}

/** Escapa los comodines de LIKE para buscar el texto tal cual lo escribió el usuario. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (match) => `\\${match}`);
}
