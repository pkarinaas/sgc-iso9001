import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { supabase } from '../supabase/supabase.client';
import { extractRoleName, extractRoleNames, formatRoleLabel } from '../models/user.model';

describe('AuthService & Multi-Role Helpers', () => {
  let service: AuthService;
  let router: Router;

  const mockSession = {
    access_token: 'fake-token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'fake-refresh',
    user: {
      id: 'usr-123',
      email: 'usuario@empresa.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
  } as unknown as Session;

  interface TableMockResponses {
    users?: { data: unknown; error?: unknown };
    user_roles?: { data: unknown; error?: unknown };
    roles?: { data: unknown; error?: unknown };
  }

  function mockSupabaseTables(responses: TableMockResponses) {
    const usersSelectSpy = vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: responses.users?.data ?? null,
          error: responses.users?.error ?? null,
        }),
      }),
    }));

    const userRolesSelectSpy = vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockResolvedValue({
        data: responses.user_roles?.data ?? [],
        error: responses.user_roles?.error ?? null,
      }),
    }));

    const rolesSelectSpy = vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: responses.roles?.data ?? null,
          error: responses.roles?.error ?? null,
        }),
      }),
    }));

    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'users') {
        return { select: usersSelectSpy } as never;
      }
      if (table === 'user_roles') {
        return { select: userRolesSelectSpy } as never;
      }
      if (table === 'roles') {
        return { select: rolesSelectSpy } as never;
      }
      return { select: vi.fn() } as never;
    });

    return { fromSpy, usersSelectSpy, userRolesSelectSpy, rolesSelectSpy };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: mockSession },
      error: null,
    });
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn(), id: 'sub-1', callback: vi.fn() } },
    } as never);
    vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null });

    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    service = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  describe('extractRoleNames / extractRoleName / formatRoleLabel', () => {
    it('should extract unique priority-sorted role names from user_roles', () => {
      const roles = extractRoleNames({
        user_roles: [
          { role_id: 5, roles: { id: 5, name: 'VIEWER' } },
          { role_id: 3, roles: { id: 3, name: 'REVIEWER' } },
          { role_id: 4, roles: { id: 4, name: 'APPROVER' } },
          { role_id: 3, roles: { id: 3, name: 'REVIEWER' } },
        ],
      });

      expect(roles).toEqual(['APPROVER', 'REVIEWER', 'VIEWER']);
      expect(
        extractRoleName({
          user_roles: [
            { role_id: 3, roles: { id: 3, name: 'REVIEWER' } },
            { role_id: 4, roles: { id: 4, name: 'APPROVER' } },
          ],
        }),
      ).toBe('APPROVER');
    });

    it('should fall back to legacy roles relation when user_roles is absent or empty', () => {
      expect(extractRoleNames({ user_roles: [], roles: { name: 'EDITOR' } as never })).toEqual([
        'EDITOR',
      ]);
      expect(extractRoleNames({ name: 'ADMIN' })).toEqual(['ADMIN']);
      expect(extractRoleNames(null)).toEqual([]);
    });

    it('should map roles to Spanish labels with fallback', () => {
      expect(formatRoleLabel('ADMIN')).toBe('Administrador');
      expect(formatRoleLabel('APPROVER')).toBe('Aprobador');
      expect(formatRoleLabel('REVIEWER')).toBe('Revisor');
      expect(formatRoleLabel('EDITOR')).toBe('Editor');
      expect(formatRoleLabel('VIEWER')).toBe('Lector');
      expect(formatRoleLabel(null)).toBe('Usuario');
    });
  });

  it('should load profile and multiple roles using separate unambiguous queries', async () => {
    const { usersSelectSpy, userRolesSelectSpy } = mockSupabaseTables({
      users: {
        data: {
          id: 'usr-123',
          email: 'usuario@empresa.com',
          full_name: 'María López',
          role_id: 3,
          is_active: true,
          created_at: '2026-11-20T10:00:00Z',
          assigned_processes: ['calidad'],
        },
      },
      user_roles: {
        data: [
          { role_id: 3, roles: { id: 3, name: 'REVIEWER' } },
          { role_id: 4, roles: { id: 4, name: 'APPROVER' } },
        ],
      },
    });

    const profile = await service.getCurrentUserProfile();

    expect(usersSelectSpy).toHaveBeenCalledWith(
      'id, email, full_name, role_id, is_active, created_at, assigned_processes',
    );
    expect(userRolesSelectSpy).toHaveBeenCalledWith('role_id, roles(id, name)');
    expect(profile?.roleNames).toEqual(['APPROVER', 'REVIEWER']);
    expect(profile?.user_roles).toHaveLength(2);
    expect(service.userRoles()).toEqual(['APPROVER', 'REVIEWER']);
    expect(service.userRole()).toBe('APPROVER');
    expect(service.currentUser()?.id).toBe('usr-123');
    expect(service.hasRole('reviewer')).toBe(true);
    expect(service.hasRole('APPROVER')).toBe(true);
    expect(service.hasRole('ADMIN')).toBe(false);
    expect(service.hasAnyRole(['ADMIN', 'REVIEWER'])).toBe(true);
    expect(service.hasAnyRole(['ADMIN', 'EDITOR'])).toBe(false);
  });

  it('should gracefully fall back to public.roles when user_roles query errors or returns empty', async () => {
    mockSupabaseTables({
      users: {
        data: {
          id: 'usr-123',
          email: 'admin@empresa.com',
          full_name: 'Carlos Gómez',
          role_id: 1,
          is_active: true,
          created_at: '2026-11-20T10:00:00Z',
          assigned_processes: [],
        },
      },
      user_roles: {
        data: null,
        error: { message: 'Temporary RLS or table failure' },
      },
      roles: {
        data: { id: 1, name: 'ADMIN', description: 'Administrador', created_at: '' },
      },
    });

    const profile = await service.getCurrentUserProfile();

    expect(profile?.roleNames).toEqual(['ADMIN']);
    expect(profile?.roles?.name).toBe('ADMIN');
    expect(service.userRoles()).toEqual(['ADMIN']);
    expect(service.userRole()).toBe('ADMIN');
    expect(service.hasRole('ADMIN')).toBe(true);
  });

  it('should support single-role users via getUserRoles and legacy getUserRole', async () => {
    mockSupabaseTables({
      user_roles: {
        data: [{ role_id: 1, roles: { id: 1, name: 'ADMIN' } }],
      },
    });

    const roles = await service.getUserRoles();
    expect(roles).toEqual(['ADMIN']);
    expect(await service.getUserRole()).toBe('ADMIN');
    expect(service.hasRole('ADMIN')).toBe(true);
  });

  it('should return empty roles when there is no active session', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    const unauthService = TestBed.inject(AuthService);

    expect(await unauthService.getUserRoles()).toEqual([]);
    expect(await unauthService.getUserRole()).toBeNull();
    expect(unauthService.hasAnyRole(['ADMIN'])).toBe(false);
  });

  it('should clear session, userRoles, userRole, and currentUser on signOut', async () => {
    mockSupabaseTables({
      users: {
        data: {
          id: 'usr-123',
          email: 'usuario@empresa.com',
          full_name: 'María López',
          role_id: 1,
          is_active: true,
          created_at: '',
        },
      },
      user_roles: {
        data: [{ role_id: 1, roles: { id: 1, name: 'ADMIN' } }],
      },
    });

    await service.getCurrentUserProfile();
    expect(service.userRoles()).toEqual(['ADMIN']);

    await service.signOut();

    expect(service.session()).toBeNull();
    expect(service.userRoles()).toEqual([]);
    expect(service.userRole()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
