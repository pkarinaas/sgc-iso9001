import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

// Helpers

/**
 * Creates a minimal mock of AuthService with controllable `isAuthenticated`
 * and `initialized` signals, plus a no-op `waitForInitialization()`.
 *
 * `initialized` is set to `true` by default so the guard never waits in tests,
 * keeping them synchronous-friendly (the mock resolves immediately).
 */
function createAuthServiceMock(authenticated: boolean) {
  return {
    isAuthenticated: signal(authenticated),
    session: signal(null),
    initialized: signal(true),
    waitForInitialization: vi.fn(() => Promise.resolve()),
  };
}

/**
 * Executes the authGuard function within a TestBed injection context.
 * Returns a Promise because the guard is now async.
 */
async function runGuard(): Promise<boolean | UrlTree> {
  return TestBed.runInInjectionContext(() => authGuard({} as never, {} as never)) as Promise<
    boolean | UrlTree
  >;
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

  it('should allow navigation when the user is authenticated', async () => {
    // Override the mock with an authenticated state.
    TestBed.overrideProvider(AuthService, {
      useValue: createAuthServiceMock(true),
    });

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('should redirect to /login when the user is NOT authenticated', async () => {
    // The beforeEach already sets up an unauthenticated mock.
    const result = await runGuard();

    expect(result).toBeInstanceOf(UrlTree);

    const router = TestBed.inject(Router);
    const expected = router.createUrlTree(['/login']);
    expect((result as UrlTree).toString()).toBe(expected.toString());
  });

  it('should call isAuthenticated() on every guard invocation', async () => {
    const mockService = createAuthServiceMock(true);
    const spy = vi.spyOn(mockService, 'isAuthenticated');

    TestBed.overrideProvider(AuthService, { useValue: mockService });

    await runGuard();

    // Signal reads register as a call when accessed as a function.
    expect(spy).toHaveBeenCalled();
  });

  it('should call waitForInitialization() before evaluating isAuthenticated()', async () => {
    const mockService = createAuthServiceMock(true);

    TestBed.overrideProvider(AuthService, { useValue: mockService });

    await runGuard();

    expect(mockService.waitForInitialization).toHaveBeenCalledOnce();
  });

  it('should await initialization even when initialized is false initially', async () => {
    // Simulate a service that starts uninitialized but resolves quickly.
    const mockService = {
      isAuthenticated: signal(false),
      session: signal(null),
      initialized: signal(false),
      waitForInitialization: vi.fn(() => Promise.resolve()),
    };

    TestBed.overrideProvider(AuthService, { useValue: mockService });

    const result = await runGuard();

    expect(mockService.waitForInitialization).toHaveBeenCalledOnce();
    // After initialization, isAuthenticated() returns false → redirect.
    expect(result).toBeInstanceOf(UrlTree);
  });
});
