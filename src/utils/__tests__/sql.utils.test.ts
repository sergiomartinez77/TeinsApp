import { containsAnyCondition, escapeLike, likeCaseVariants } from '../sql.utils';

/**
 * Imita `LIKE '%patrón%' ESCAPE '\'` de SQLite: ignora mayúsculas solo en A–Z.
 * Sirve para comprobar qué textos guardados encuentra cada variante.
 */
function sqliteContains(stored: string, pattern: string): boolean {
  const fold = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const literal = pattern.slice(1, -1).replace(/\\([\\%_])/g, '$1');
  return fold(stored).includes(fold(literal));
}

function finds(stored: string, search: string): boolean {
  const { parameters } = containsAnyCondition(['columna'], search);
  return parameters.some((pattern) => sqliteContains(stored, String(pattern)));
}

describe('likeCaseVariants', () => {
  it('sin letras acentuadas da una sola variante: LIKE ya ignora mayúsculas en A–Z', () => {
    expect(likeCaseVariants('cable')).toEqual(['cable']);
    expect(likeCaseVariants('CABLE 3x2')).toEqual(['CABLE 3x2']);
  });

  it('con letras acentuadas añade minúsculas, mayúsculas y mayúscula inicial', () => {
    expect(likeCaseVariants('ÉXITO')).toEqual(['ÉXITO', 'éxito']);
    expect(likeCaseVariants('josé álvarez')).toEqual([
      'josé álvarez',
      'JOSÉ ÁLVAREZ',
      'José Álvarez',
    ]);
  });
});

describe('containsAnyCondition', () => {
  it('genera una condición por columna y variante, siempre con parámetros', () => {
    const query = containsAnyCondition(['code', 'name'], 'ñ');

    expect(query.sql).toBe(
      "code LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'",
    );
    expect(query.parameters).toEqual(['%ñ%', '%Ñ%', '%ñ%', '%Ñ%']);
  });

  it('mantiene escapados los comodines en todas las variantes', () => {
    expect(containsAnyCondition(['name'], '50%_á').parameters).toEqual([
      `%${escapeLike('50%_á')}%`,
      `%${escapeLike('50%_Á')}%`,
    ]);
  });

  it('encuentra el texto aunque difieran las mayúsculas de las letras acentuadas', () => {
    expect(finds('Reparación con éxito', 'ÉXITO')).toBe(true);
    expect(finds('ÉXITO TOTAL', 'éxito')).toBe(true);
    expect(finds('Éxito', 'éxito')).toBe(true);
    expect(finds('José Álvarez', 'josé álvarez')).toBe(true);
    expect(finds('CAÑERÍA PVC', 'cañería')).toBe(true);
    expect(finds('Cañería', 'CAÑERÍA')).toBe(true);
    expect(finds('Inspección', 'otra cosa')).toBe(false);
  });
});
