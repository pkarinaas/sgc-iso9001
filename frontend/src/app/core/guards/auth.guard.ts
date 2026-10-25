import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Functional guard that protects routes requiring an active Supabase session.
 * Redirects unauthenticated users to the /login page.
 *
 * The guard awaits `waitForInitialization()` before evaluating `isAuthenticated()`
 * to prevent the race condition that occurs when the page is reloaded (F5) and
 * the Supabase `getSession()` promise has not yet resolved.
 *
 * Usage in route config:
 *   { path: 'dashboard', canActivate: [authGuard], ... }
 */
export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Wait for the initial session hydration to complete (no-op when already done).
  await authService.waitForInitialization();

  if (authService.isAuthenticated()) {
    return true;
  }

  // No active session — redirect to login, preserving the attempted URL.
  return router.createUrlTree(['/login']);
};
