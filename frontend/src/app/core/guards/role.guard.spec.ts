import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { roleGuard } from './role.guard';
import { AuthService } from '../services/auth.service';
import { supabase } from '../supabase/supabase.client';

describe('roleGuard', () => {
  const mockAdminSession = {
    access_token: 'fake-token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'fake-refresh',
    user: {
      id: 'admin-uuid-123',
      email: 'admin@empresa.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
  } as unknown as Session;

  function createAuthServiceMock(session: Session | null = mockAdminSession) {
    return {
      session: signal(session),
      initialized: signal(true),
      waitForInitialization: vi.fn(() => Promise.resolve()),
    };
  }

  function mockSupabaseResponse(data: unknown, error: unknown = null) {
    const single = vi.fn().mockResolvedValue({ data, error });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    return vi.spyOn(supabase, 'from').mockReturnValue({ select } as never);
  }

  async function runGuard(): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() => roleGuard({} as never, {} as never)) as Promise<
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

  it('should allow activation if user is ADMIN and active', async () => {
    mockSupabaseResponse({
      is_active: true,
      roles: { name: 'ADMIN' },
    });

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('should redirect to /dashboard if user is not ADMIN', async () => {
    mockSupabaseResponse({
      is_active: true,
      roles: { name: 'EDITOR' },
    });

    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect((result as UrlTree).toString()).toBe(router.createUrlTree(['/dashboard']).toString());
  });

  it('should redirect to /dashboard if user is inactive', async () => {
    mockSupabaseResponse({
      is_active: false,
      roles: { name: 'ADMIN' },
    });

    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect((result as UrlTree).toString()).toBe(router.createUrlTree(['/dashboard']).toString());
  });

  it('should redirect to /login if there is no session', async () => {
    TestBed.overrideProvider(AuthService, {
      useValue: createAuthServiceMock(null),
    });

    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    expect((result as UrlTree).toString()).toBe(router.createUrlTree(['/login']).toString());
  });
});
