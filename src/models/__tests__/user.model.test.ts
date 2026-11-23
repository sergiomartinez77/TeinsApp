import {
  canCreateVisit,
  canEditMinStock,
  canManageInventory,
  canViewAllVisits,
  DEMO_USER,
  displayName,
  firstName,
  initials,
  parseStoredProfile,
  parseUserRole,
  profileFromAuthUser,
  profileFromRow,
  type UserProfile,
} from '../user.model';

const user = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'u1',
  email: 'carlos@example.com',
  role: 'technician',
  fullName: 'Carlos Pérez Gómez',
  phone: null,
  avatarUrl: null,
  ...overrides,
});

describe('modelo de usuario', () => {
  it('asume técnico cuando el rol no es válido', () => {
    expect(parseUserRole('office')).toBe('office');
    expect(parseUserRole('superusuario')).toBe('technician');
    expect(parseUserRole(undefined)).toBe('technician');
  });

  it('aplica los permisos por rol', () => {
    expect(canCreateVisit('technician')).toBe(true);
    expect(canCreateVisit('office')).toBe(false);
    expect(canViewAllVisits('office')).toBe(true);
    expect(canViewAllVisits('technician')).toBe(false);
  });

  it('inventario: admin y oficina registran movimientos; solo admin cambia el mínimo', () => {
    expect(canManageInventory('admin')).toBe(true);
    expect(canManageInventory('office')).toBe(true);
    expect(canManageInventory('technician')).toBe(false);
    expect(canManageInventory('client')).toBe(false);
    expect(canEditMinStock('admin')).toBe(true);
    expect(canEditMinStock('office')).toBe(false);
    expect(canEditMinStock('technician')).toBe(false);
  });

  it('construye el perfil desde una fila de profiles', () => {
    expect(
      profileFromRow({
        id: 'u1',
        email: 'carlos@example.com',
        full_name: ' Carlos Pérez ',
        role: 'technician',
        phone: '',
        avatar_url: null,
      }),
    ).toEqual(user({ fullName: 'Carlos Pérez' }));
  });

  it('construye el perfil desde la sesión cuando no hay fila de profiles', () => {
    const profile = profileFromAuthUser({
      id: 'u2',
      email: 'ana@example.com',
      user_metadata: { full_name: 'Ana Ruiz', role: 'office' },
    });

    expect(profile).toMatchObject({ id: 'u2', fullName: 'Ana Ruiz', role: 'office' });
    expect(profileFromAuthUser({ id: 'u3' })).toMatchObject({ email: '', role: 'technician' });
  });

  it('valida el perfil guardado en el dispositivo', () => {
    const stored = user();
    expect(parseStoredProfile(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredProfile(null)).toBeNull();
    expect(parseStoredProfile('{dañado')).toBeNull();
    expect(parseStoredProfile(JSON.stringify({ email: 'sin-id@example.com' }))).toBeNull();
    expect(parseStoredProfile('"texto"')).toBeNull();
  });

  it('calcula nombre visible, primer nombre e iniciales', () => {
    expect(displayName(user())).toBe('Carlos Pérez Gómez');
    expect(firstName(user())).toBe('Carlos');
    expect(initials(user())).toBe('CP');

    const sinNombre = user({ fullName: null });
    expect(displayName(sinNombre)).toBe('carlos@example.com');
    expect(firstName(sinNombre)).toBe('carlos');
    expect(initials(sinNombre)).toBe('CA');
    expect(initials(user({ fullName: 'Ana' }))).toBe('AN');
  });

  it('el usuario demo es un técnico con identificador en formato UUID', () => {
    expect(DEMO_USER.role).toBe('technician');
    expect(DEMO_USER.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
