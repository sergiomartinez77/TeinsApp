import { randomUUID } from 'expo-crypto';

import { generateId } from '../uuid.utils';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '0b8f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4'),
}));

it('genera el id con randomUUID de expo-crypto (en el dispositivo, sin red)', () => {
  expect(generateId()).toBe('0b8f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4');
  expect(randomUUID).toHaveBeenCalledTimes(1);
});
