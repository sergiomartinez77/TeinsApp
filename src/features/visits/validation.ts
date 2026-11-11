import { z } from 'zod';

import { VISIT_TYPES } from '@/models/visit.model';

/** Texto opcional: se recorta y, si queda vacío, se trata como "sin valor". */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value.length > 0 ? value : null));

/** Validación del formulario "Nueva visita". */
export const createVisitSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Escribe un título para la visita.')
    .max(200, 'El título no puede superar los 200 caracteres.'),
  visitType: z.enum(VISIT_TYPES, 'Selecciona el tipo de visita.'),
  address: optionalText(300, 'La dirección no puede superar los 300 caracteres.'),
  description: optionalText(2000, 'La descripción no puede superar los 2000 caracteres.'),
});

/** Valores tal como los escribe el usuario. */
export type CreateVisitFormValues = z.input<typeof createVisitSchema>;
/** Valores ya validados y normalizados. */
export type CreateVisitInput = z.output<typeof createVisitSchema>;
