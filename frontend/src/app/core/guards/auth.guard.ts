import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Functional guard that protects routes requiring an active Supabase session.
 * Redirects unauthenticated users to the /login page.
 *
 * Usage in route config:
 *   { path: 'dashboard', canActivate: [authGuard], ... }
 */
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  // No active session — redirect to login, preserving the attempted URL
  return router.createUrlTree(['/login']);
};
