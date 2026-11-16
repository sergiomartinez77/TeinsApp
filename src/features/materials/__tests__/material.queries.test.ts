import { buildCatalogQuery, VISIT_MATERIALS_SQL } from '../services/material.queries';

describe('buildCatalogQuery', () => {
  it('sin búsqueda solo filtra los materiales activos y aplica el límite', () => {
    const query = buildCatalogQuery({ search: '', limit: 31 });

    expect(query.sql).toContain('FROM material_catalog');
    expect(query.sql).toContain('WHERE is_active = 1');
    expect(query.sql).not.toContain('LIKE');
    expect(query.sql).toMatch(/ORDER BY name .*LIMIT \?$/);
    expect(query.parameters).toEqual([31]);
  });

  it('busca en código y nombre con parámetros', () => {
    const query = buildCatalogQuery({ search: '  cable ', limit: 31 });

    expect(query.sql).toContain('is_active = 1 AND');
    expect(query.sql).toContain("code LIKE ? ESCAPE '\\'");
    expect(query.sql).toContain("name LIKE ? ESCAPE '\\'");
    expect(query.sql).not.toContain('cable');
    expect(query.parameters).toEqual(['%cable%', '%cable%', 31]);
  });

  it('con letras acentuadas busca también la variante en mayúsculas y minúsculas', () => {
    const query = buildCatalogQuery({ search: 'CAÑERÍA', limit: 31 });

    expect(query.sql).toContain(
      "(code LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')",
    );
    // "Cañería" no se añade: solo difiere de "cañería" en la C, que LIKE ya iguala.
    expect(query.parameters).toEqual([
      ...['code', 'name'].flatMap(() => ['%CAÑERÍA%', '%cañería%']),
      31,
    ]);
  });

  it('trata los comodines como texto literal', () => {
    const query = buildCatalogQuery({ search: '50%_x', limit: 10 });
    expect(query.parameters).toEqual(['%50\\%\\_x%', '%50\\%\\_x%', 10]);
  });
});

describe('VISIT_MATERIALS_SQL', () => {
  it('filtra por visita y ordena por fecha de creación', () => {
    expect(VISIT_MATERIALS_SQL).toContain('WHERE visit_id = ?');
    expect(VISIT_MATERIALS_SQL).toContain('ORDER BY created_at ASC');
  });
});
