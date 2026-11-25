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
});
