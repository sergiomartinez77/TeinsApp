/**
 * Sustituto de `@/utils/uuid.utils` para los tests: ids deterministas
 * (`id-1`, `id-2`, …). En Jest `expo-crypto.randomUUID` no está disponible.
 *
 *   jest.mock('@/utils/uuid.utils', () => jest.requireActual('@/test-utils/sequential-ids'));
 */

let counter = 0;
let prefix = 'id';

export function generateId(): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Reinicia la secuencia (llamar en `beforeEach`). */
export function resetIds(nextPrefix = 'id'): void {
  counter = 0;
  prefix = nextPrefix;
}
