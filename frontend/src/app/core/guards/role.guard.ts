import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Functional guard that ensures the authenticated user has at least one allowed role
 * (defaults to `['ADMIN']` when `route.data['roles']` is omitted) and an active account
 * in `public.users` before granting access to protected routes.
 *
 * If unauthenticated, redirects to /login.
 * If unauthorized (inactive or missing any required role), redirects to /dashboard.
 */
export const roleGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Wait for initial session hydration to complete.
  await authService.waitForInitialization();

  const session = authService.session();
  if (!session) {
    return router.createUrlTree(['/login']);
  }

  const routeRoles = route?.data?.['roles'];
  const allowedRoles =
    Array.isArray(routeRoles) && routeRoles.length > 0 ? (routeRoles as string[]) : ['ADMIN'];

  const profile = await authService.getCurrentUserProfile();
  if (!profile || profile.is_active !== true || !authService.hasAnyRole(allowedRoles)) {
    return router.createUrlTree(['/dashboard']);
  }

  return true;
};
