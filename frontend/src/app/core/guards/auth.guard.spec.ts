import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { Router, UrlTree, type GuardResult } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

// Helpers

/** Creates a minimal mock of AuthService with a controllable isAuthenticated signal. */
function createAuthServiceMock(authenticated: boolean) {
  return {
    isAuthenticated: signal(authenticated),
    session: signal(null),
  };
}

/** Executes the authGuard function within a TestBed injection context. */
function runGuard(): GuardResult {
  return TestBed.runInInjectionContext(() => authGuard({} as never, {} as never)) as GuardResult;
}

// Tests

describe('authGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        // Prevent the real AuthService (and Supabase) from being instantiated.
        {
          provide: AuthService,
          useValue: createAuthServiceMock(false),
        },
      ],
    });
  });

  it('should allow navigation when the user is authenticated', () => {
    // Override the mock with an authenticated state.
    TestBed.overrideProvider(AuthService, {
      useValue: createAuthServiceMock(true),
    });

    const result = runGuard();

    expect(result).toBe(true);
  });

  it('should redirect to /login when the user is NOT authenticated', () => {
    // The beforeEach already sets up an unauthenticated mock.
    const result = runGuard();

    expect(result).toBeInstanceOf(UrlTree);

    const router = TestBed.inject(Router);
    const expected = router.createUrlTree(['/login']);
    expect((result as UrlTree).toString()).toBe(expected.toString());
  });

  it('should call isAuthenticated() on every guard invocation', () => {
    const mockService = createAuthServiceMock(true);
    const spy = vi.spyOn(mockService, 'isAuthenticated');

    TestBed.overrideProvider(AuthService, { useValue: mockService });

    runGuard();

    // Signal reads register as a call when accessed as a function.
    expect(spy).toHaveBeenCalled();
  });
});
