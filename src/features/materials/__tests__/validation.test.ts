import { MATERIAL_MESSAGES, materialEntrySchema, quantityValueError } from '../validation';

const parse = (quantity: string, observations = '') =>
  materialEntrySchema.safeParse({ quantity, observations });

const firstMessage = (quantity: string, observations = '') => {
  const result = parse(quantity, observations);
  return result.success ? null : result.error.issues[0]?.message;
};

describe('materialEntrySchema', () => {
  it.each([
    ['', MATERIAL_MESSAGES.quantityRequired],
    ['   ', MATERIAL_MESSAGES.quantityRequired],
    ['abc', MATERIAL_MESSAGES.invalidNumber],
    ['1,2,3', MATERIAL_MESSAGES.invalidNumber],
    ['0', MATERIAL_MESSAGES.quantityPositive],
    ['0,000', MATERIAL_MESSAGES.quantityPositive],
    ['-2', MATERIAL_MESSAGES.quantityPositive],
    ['1,2345', MATERIAL_MESSAGES.maxDecimals],
    ['1000000000', MATERIAL_MESSAGES.quantityTooLarge],
  ])('rechaza la cantidad "%s"', (quantity, message) => {
    expect(firstMessage(quantity)).toBe(message);
  });

  it('acepta coma decimal y guarda la cantidad como número', () => {
    const result = parse(' 12,5 ');
    expect(result.success && result.data).toEqual({ quantity: 12.5, observations: null });
  });

  it('acepta punto decimal y hasta 3 decimales', () => {
    const result = parse('0.125');
    expect(result.success && result.data.quantity).toBe(0.125);
    expect(firstMessage('1,250')).toBeNull();
    expect(firstMessage('999999999')).toBeNull();
  });

  it('recorta las observaciones y las vacías quedan en null', () => {
    const empty = parse('1', '    ');
    expect(empty.success && empty.data.observations).toBeNull();
    const filled = parse('1', '  Tramo sala 2  ');
    expect(filled.success && filled.data.observations).toBe('Tramo sala 2');
  });

  it('rechaza observaciones de más de 500 caracteres', () => {
    expect(firstMessage('1', 'a'.repeat(501))).toBe(MATERIAL_MESSAGES.observationsTooLong);
    expect(firstMessage('1', 'a'.repeat(500))).toBeNull();
  });
});

describe('quantityValueError', () => {
  it('valida una cantidad ya convertida a número', () => {
    expect(quantityValueError(2)).toBeNull();
    expect(quantityValueError(0)).toBe(MATERIAL_MESSAGES.quantityPositive);
    expect(quantityValueError(Number.NaN)).toBe(MATERIAL_MESSAGES.invalidNumber);
    expect(quantityValueError(0.0001)).toBe(MATERIAL_MESSAGES.maxDecimals);
  });
});
