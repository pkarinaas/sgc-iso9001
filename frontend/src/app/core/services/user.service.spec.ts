import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from './user.service';
import { supabase } from '../supabase/supabase.client';

describe('UserService', () => {
  let service: UserService;

  const expectedDisambiguatedSelect =
    'id, email, full_name, role_id, is_active, created_at, assigned_processes, roles:roles!users_role_id_fkey(id, name, description), user_roles(role_id, roles(id, name))';

  beforeEach(() => {
    vi.restoreAllMocks();
    TestBed.configureTestingModule({});
    service = TestBed.inject(UserService);
  });

  it('should load users using explicit FK disambiguation and normalize roleNames and legacy roles', async () => {
    const mockRows = [
      {
        id: 'usr-1',
        email: 'admin@empresa.com',
        full_name: 'Carlos Gómez',
        role_id: 1,
        is_active: true,
        created_at: '2026-11-20T10:00:00Z',
        assigned_processes: ['calidad'],
        roles: { id: 1, name: 'ADMIN', description: 'Administrador', created_at: '' },
        user_roles: [{ role_id: 1, roles: { id: 1, name: 'ADMIN' } }],
      },
      {
        id: 'usr-2',
        email: 'multi@empresa.com',
        full_name: 'María López',
        role_id: null,
        is_active: true,
        created_at: '2026-11-21T10:00:00Z',
        assigned_processes: ['hematologia'],
        roles: null,
        user_roles: [
          { role_id: 3, roles: { id: 3, name: 'REVIEWER' } },
          { role_id: 4, roles: { id: 4, name: 'APPROVER' } },
        ],
      },
    ];

    const orderSpy = vi.fn().mockResolvedValue({ data: mockRows, error: null });
    const selectSpy = vi.fn().mockReturnValue({ order: orderSpy });
    vi.spyOn(supabase, 'from').mockReturnValue({ select: selectSpy } as never);

    await service.loadUsers();

    expect(selectSpy).toHaveBeenCalledWith(expectedDisambiguatedSelect);
    expect(service.error()).toBeNull();
    expect(service.loading()).toBe(false);
    expect(service.users()).toHaveLength(2);
    expect(service.users()[0].roleNames).toEqual(['ADMIN']);
    expect(service.users()[1].roleNames).toEqual(['APPROVER', 'REVIEWER']);
    expect(service.users()[1].roles?.name).toBe('APPROVER');
  });

  it('should set error signal and reset loading when loadUsers fails', async () => {
    const orderSpy = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Could not embed because more than one relationship was found' },
    });
    const selectSpy = vi.fn().mockReturnValue({ order: orderSpy });
    vi.spyOn(supabase, 'from').mockReturnValue({ select: selectSpy } as never);

    await service.loadUsers();

    expect(service.loading()).toBe(false);
    expect(service.error()).toContain('more than one relationship');
    expect(service.users()).toEqual([]);
  });

  it('should fetch an individual user profile using explicit FK disambiguation', async () => {
    const singleSpy = vi.fn().mockResolvedValue({
      data: {
        id: 'usr-3',
        email: 'revisor@empresa.com',
        full_name: 'Juan Pérez',
        role_id: 3,
        is_active: true,
        created_at: '',
        assigned_processes: ['quimica_clinica'],
        roles: null,
        user_roles: [{ role_id: 3, roles: { id: 3, name: 'REVIEWER' } }],
      },
      error: null,
    });
    const eqSpy = vi.fn().mockReturnValue({ single: singleSpy });
    const selectSpy = vi.fn().mockReturnValue({ eq: eqSpy });
    vi.spyOn(supabase, 'from').mockReturnValue({ select: selectSpy } as never);

    const profile = await service.getUserProfile('usr-3');

    expect(selectSpy).toHaveBeenCalledWith(expectedDisambiguatedSelect);
    expect(eqSpy).toHaveBeenCalledWith('id', 'usr-3');
    expect(profile?.roleNames).toEqual(['REVIEWER']);
    expect(profile?.roles?.name).toBe('REVIEWER');
  });

  it('should update primary role_id on public.users and sync multiple roles in public.user_roles', async () => {
    const rolesOrderSpy = vi.fn().mockResolvedValue({
      data: [
        { id: 1, name: 'ADMIN', description: null, created_at: '' },
        { id: 3, name: 'REVIEWER', description: null, created_at: '' },
        { id: 4, name: 'APPROVER', description: null, created_at: '' },
      ],
      error: null,
    });
    const usersUpdateEqSpy = vi.fn().mockResolvedValue({ error: null });
    const usersUpdateSpy = vi.fn().mockReturnValue({ eq: usersUpdateEqSpy });
    const userRolesUpsertSpy = vi.fn().mockResolvedValue({ error: null });
    const userRolesNotSpy = vi.fn().mockResolvedValue({ error: null });
    const userRolesDeleteEqSpy = vi.fn().mockReturnValue({ not: userRolesNotSpy });
    const userRolesDeleteSpy = vi.fn().mockReturnValue({ eq: userRolesDeleteEqSpy });
    const usersOrderSpy = vi.fn().mockResolvedValue({ data: [], error: null });

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'roles') {
        return { select: vi.fn().mockReturnValue({ order: rolesOrderSpy }) } as never;
      }
      if (table === 'users') {
        return {
          update: usersUpdateSpy,
          select: vi.fn().mockReturnValue({ order: usersOrderSpy }),
        } as never;
      }
      if (table === 'user_roles') {
        return {
          upsert: userRolesUpsertSpy,
          delete: userRolesDeleteSpy,
        } as never;
      }
      return {} as never;
    });

    await service.loadRoles();
    const result = await service.updateUser('usr-2', {
      full_name: 'María López',
      role_ids: [3, 4],
      assigned_processes: ['calidad'],
    });

    expect(result).toEqual({ error: null });
    expect(usersUpdateSpy).toHaveBeenCalledWith({
      full_name: 'María López',
      role_id: 4,
      assigned_processes: ['calidad'],
    });
    expect(usersUpdateEqSpy).toHaveBeenCalledWith('id', 'usr-2');
    expect(userRolesUpsertSpy).toHaveBeenCalledWith(
      [
        { user_id: 'usr-2', role_id: 3 },
        { user_id: 'usr-2', role_id: 4 },
      ],
      { onConflict: 'user_id,role_id', ignoreDuplicates: true },
    );
    expect(userRolesDeleteEqSpy).toHaveBeenCalledWith('user_id', 'usr-2');
    expect(userRolesNotSpy).toHaveBeenCalledWith('role_id', 'in', '(3,4)');
  });

  it('should reject updateUser and createUser when role_ids is empty', async () => {
    expect(
      await service.updateUser('usr-1', {
        full_name: 'Test',
        role_ids: [],
      }),
    ).toEqual({ error: 'Debe seleccionar al menos un rol.' });

    expect(
      await service.createUser({
        email: 'test@empresa.com',
        password: 'password123',
        full_name: 'Test',
        role_ids: [],
      }),
    ).toEqual({ error: 'Debe seleccionar al menos un rol.' });
  });
});
