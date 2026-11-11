import { z } from 'zod';

/** Validación del formulario de inicio de sesión. */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Ingresa tu correo electrónico.')
    .pipe(z.email('El correo electrónico no es válido.')),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
