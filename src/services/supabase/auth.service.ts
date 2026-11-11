import type { SupabaseClient } from '@supabase/supabase-js';

import { SECURE_KEYS } from '@/constants/app.constants';
import {
  parseStoredProfile,
  profileFromAuthUser,
  profileFromRow,
  type UserProfile,
} from '@/models/user.model';
import { getSecureItem, removeSecureItem, setSecureItem } from '@/services/storage/secure-storage';
import { appError, err, ok, type AppError, type Result } from '@/types/errors';
import { scopedLogger } from '@/utils/logger';

import { getSupabase } from './client';

const log = scopedLogger('auth');

export const AUTH_MESSAGES = {
  invalidCredentials: 'Correo o contraseña incorrectos.',
  emailNotConfirmed:
    'Tu correo aún no ha sido confirmado. Revisa tu bandeja de entrada o contacta al administrador.',
  rateLimit: 'Demasiados intentos. Espera unos minutos e intenta nuevamente.',
  offline: 'No hay conexión a Internet. Necesitas conexión para iniciar sesión.',
  sessionExpired: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
  unknown: 'No se pudo iniciar sesión. Por favor intenta nuevamente.',
} as const;

interface AuthErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

/** Traduce un error de Supabase Auth a un mensaje en español para el usuario. */
export function mapAuthError(error: unknown): AppError {
  const source = (typeof error === 'object' && error !== null ? error : {}) as AuthErrorLike;
  const code = typeof source.code === 'string' ? source.code.toLowerCase() : '';
  const message = typeof source.message === 'string' ? source.message.toLowerCase() : '';
  const name = typeof source.name === 'string' ? source.name : '';
  const status = typeof source.status === 'number' ? source.status : undefined;

  if (
    name === 'AuthRetryableFetchError' ||
    status === 0 ||
    /network request failed|failed to fetch|network error|timeout/.test(message)
  ) {
    return appError('network', { message: AUTH_MESSAGES.offline, cause: error });
  }
  if (
    status === 429 ||
    code.includes('rate_limit') ||
    /too many requests|rate limit/.test(message)
  ) {
    return appError('authentication', {
      message: AUTH_MESSAGES.rateLimit,
      code: 'rate_limit',
      cause: error,
    });
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return appError('authentication', {
      message: AUTH_MESSAGES.emailNotConfirmed,
      code: 'email_not_confirmed',
      cause: error,
    });
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return appError('authentication', {
      message: AUTH_MESSAGES.invalidCredentials,
      code: 'invalid_credentials',
      cause: error,
    });
  }
  if (status !== undefined && status >= 500) {
    return appError('server', { cause: error });
  }
  return appError('authentication', { message: AUTH_MESSAGES.unknown, cause: error });
}

// ── Perfil guardado en el dispositivo ────────────────────────────────────────

/**
 * El perfil se guarda cifrado junto a la sesión para poder abrir la app
 * sin conexión de inmediato, sin esperar a la red.
 */
export async function saveStoredProfile(profile: UserProfile): Promise<void> {
  await setSecureItem(SECURE_KEYS.userProfile, JSON.stringify(profile));
  await setSecureItem(SECURE_KEYS.userId, profile.id);
}

export async function clearStoredProfile(): Promise<void> {
  await removeSecureItem(SECURE_KEYS.userProfile);
  await removeSecureItem(SECURE_KEYS.userId);
}

/**
 * Usuario de la sesión guardada, leído solo del dispositivo (sin red).
 * Devuelve `null` si no hay sesión o perfil guardados.
 */
export async function getStoredUser(): Promise<UserProfile | null> {
  const [session, rawProfile] = await Promise.all([
    getSecureItem(SECURE_KEYS.authSession),
    getSecureItem(SECURE_KEYS.userProfile),
  ]);
  if (!session) return null;
  return parseStoredProfile(rawProfile);
}

// ── Operaciones de sesión ────────────────────────────────────────────────────

async function loadProfile(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null },
): Promise<UserProfile> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, phone, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    if (!error && data) return profileFromRow(data as Record<string, unknown>);
  } catch (error) {
    log.warn('No se pudo leer el perfil; se usan los datos de la sesión', error);
  }
  // Respaldo: datos incluidos en la propia sesión.
  return profileFromAuthUser(user);
}

/** Inicia sesión con correo y contraseña y deja el perfil guardado en el dispositivo. */
export async function signIn(
  email: string,
  password: string,
  supabase?: SupabaseClient,
): Promise<Result<UserProfile>> {
  try {
    const client = supabase ?? getSupabase();
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return err(mapAuthError(error));
    if (!data.user) return err(mapAuthError(null));

    const profile = await loadProfile(client, data.user);
    await saveStoredProfile(profile);
    return ok(profile);
  } catch (error) {
    log.error('Fallo inesperado al iniciar sesión', error);
    return err(mapAuthError(error));
  }
}

/**
 * Cierra la sesión. Nunca falla: si no hay conexión para avisar al servidor,
 * la sesión se elimina igualmente del dispositivo.
 */
export async function signOut(supabase?: SupabaseClient): Promise<void> {
  try {
    const client = supabase ?? getSupabase();
    const { error } = await client.auth.signOut();
    if (error) log.info('Cierre de sesión solo local (sin respuesta del servidor)');
  } catch (error) {
    log.warn('Cierre de sesión solo local', error);
  }
  await removeSecureItem(SECURE_KEYS.authSession);
  await clearStoredProfile();
}

/**
 * Avisa cuando Supabase da la sesión por terminada (por ejemplo, si el
 * token de refresco ya no es válido). Devuelve la función para cancelar.
 */
export function onSessionEnded(listener: () => void, supabase?: SupabaseClient): () => void {
  const client = supabase ?? getSupabase();
  const { data } = client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') listener();
  });
  return () => data.subscription.unsubscribe();
}
