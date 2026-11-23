/** Rol del usuario. La app móvil MVP sirve principalmente al rol `technician`. */
export type UserRole = 'technician' | 'office' | 'client' | 'admin';

const ROLES: readonly UserRole[] = ['technician', 'office', 'client', 'admin'];

/** Rol a partir de texto; si no es válido se asume técnico (igual que el original). */
export function parseUserRole(value: unknown): UserRole {
  return ROLES.find((role) => role === value) ?? 'technician';
}

export function canCreateVisit(role: UserRole): boolean {
  return role === 'technician' || role === 'admin';
}

export function canViewAllVisits(role: UserRole): boolean {
  return role === 'office' || role === 'admin';
}

/** Registrar compras y ajustes de bodega (RLS: admin u oficina). */
export function canManageInventory(role: UserRole): boolean {
  return role === 'office' || role === 'admin';
}

/** Cambiar el mínimo de bodega de un material (RLS del catálogo: solo admin). */
export function canEditMinStock(role: UserRole): boolean {
  return role === 'admin';
}

/** Perfil del usuario autenticado. */
export interface UserProfile {
  /** UUID de Supabase Auth. */
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly avatarUrl: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

/** Perfil desde una fila de la tabla `profiles` (Supabase o SQLite local). */
export function profileFromRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    email: text(row.email) ?? '',
    role: parseUserRole(row.role),
    fullName: text(row.full_name),
    phone: text(row.phone),
    avatarUrl: text(row.avatar_url),
  };
}

/** Datos mínimos del usuario de Supabase Auth. */
export interface AuthUserLike {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

/**
 * Perfil a partir del usuario de Supabase Auth.
 * Es el respaldo cuando no se puede leer la tabla `profiles`.
 */
export function profileFromAuthUser(user: AuthUserLike): UserProfile {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: text(user.email) ?? '',
    role: parseUserRole(meta.role),
    fullName: text(meta.full_name),
    phone: text(meta.phone),
    avatarUrl: text(meta.avatar_url),
  };
}

/** Valida un perfil guardado en el dispositivo; `null` si está dañado. */
export function parseStoredProfile(raw: string | null): UserProfile | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.length === 0) return null;
    return {
      id: record.id,
      email: text(record.email) ?? '',
      role: parseUserRole(record.role),
      fullName: text(record.fullName),
      phone: text(record.phone),
      avatarUrl: text(record.avatarUrl),
    };
  } catch {
    return null;
  }
}

export function displayName(user: UserProfile): string {
  return user.fullName ?? user.email;
}

/** Primer nombre, para el saludo del dashboard. */
export function firstName(user: UserProfile): string {
  return displayName(user).split(/[\s@]/)[0] ?? '';
}

export function initials(user: UserProfile): string {
  const parts = (user.fullName ?? '').split(/\s+/).filter(Boolean);
  const [first, second] = parts;
  if (first && second) return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
  return (first ?? user.email).slice(0, 2).toUpperCase();
}

/** Usuario ficticio del modo demo. No existe en el servidor. */
export const DEMO_USER: UserProfile = {
  id: '00000000-0000-4000-8000-00000000de30',
  email: 'demo@teins.local',
  role: 'technician',
  fullName: 'Técnico Demo',
  phone: null,
  avatarUrl: null,
};
