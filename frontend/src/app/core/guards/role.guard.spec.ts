import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, UrlTree } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { roleGuard } from './role.guard';
import { AuthService } from '../services/auth.service';
import type { User } from '../models/user.model';

describe('roleGuard', () => {
  const mockSession = {
    access_token: 'fake-token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'fake-refresh',
    user: {
      id: 'user-uuid-123',
      email: 'user@empresa.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
  } as unknown as Session;

  function buildProfile(isActive: boolean, roleNames: string[]): User {
    return {
      id: 'user-uuid-123',
      email: 'user@empresa.com',
      full_name: 'Test User',
      role_id: 1,
      is_active: isActive,
      created_at: '',
      roleNames,
    };
  }

  function createAuthServiceMock(
    session: Session | null = mockSession,
    profile: User | null = buildProfile(true, ['ADMIN']),
  ) {
    const roles = profile?.roleNames ?? [];
    return {
      session: signal(session),
      initialized: signal(true),
      userRoles: signal(roles),
      waitForInitialization: vi.fn(() => Promise.resolve()),
      getCurrentUserProfile: vi.fn().mockResolvedValue(profile),
      hasAnyRole: vi.fn((allowed: readonly string[]) =>
        allowed.some((r) => roles.includes(r.toUpperCase())),
      ),
    };
  }

  async function runGuard(routeData: Record<string, unknown> = {}): Promise<boolean | UrlTree> {
    const route = { data: routeData } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => roleGuard(route, {} as never)) as Promise<
      boolean | UrlTree
    >;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: createAuthServiceMock(),
        },
      ],
    });
  });

  it('should allow activation if user has ADMIN role and is active', async () => {
    const result = await runGuard();
    expect(result).toBe(true);
  });

  it('should allow activation for multi-role users when any assigned role is permitted', async () => {
    TestBed.overrideProvider(AuthService, {
      useValue: createAuthServiceMock(mockSession, buildProfile(true, ['VIEWER', 'ADMIN'])),
    });
    expect(await runGuard()).toBe(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: createAuthServiceMock(mockSession, buildProfile(true, ['REVIEWER', 'APPROVER'])),
        },
      ],
    });
    expect(await runGuard({ roles: ['ADMIN', 'APPROVER'] })).toBe(true);
  });

  it('should redirect to /dashboard if user does not hold any allowed role', async () => {
    TestBed.overrideProvider(AuthService, {
      useValue: createAuthServiceMock(mockSession, buildProfile(true, ['EDITOR', 'REVIEWER'])),
    });

    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect((result as UrlTree).toString()).toBe(router.createUrlTree(['/dashboard']).toString());
  });

  it('should redirect to /dashboard if user is inactive even when holding ADMIN role', async () => {
    TestBed.overrideProvider(AuthService, {
      useValue: createAuthServiceMock(mockSession, buildProfile(false, ['ADMIN'])),
    });

    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect((result as UrlTree).toString()).toBe(router.createUrlTree(['/dashboard']).toString());
  });

  it('should redirect to /login if there is no session', async () => {
    TestBed.overrideProvider(AuthService, {
      useValue: createAuthServiceMock(null, null),
    });

    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect((result as UrlTree).toString()).toBe(router.createUrlTree(['/login']).toString());
  });
});
