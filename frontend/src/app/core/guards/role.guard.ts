import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { supabase } from '../supabase/supabase.client';

/**
 * Functional guard that ensures the authenticated user has the ADMIN role
 * and an active account in public.users before granting access to protected routes.
 *
 * If unauthenticated, redirects to /login.
 * If unauthorized (inactive or non-ADMIN role), redirects to /dashboard.
 *
 * The guard awaits `waitForInitialization()` to prevent race conditions on page reload (F5).
 */
export const roleGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Wait for initial session hydration to complete.
  await authService.waitForInitialization();

  const session = authService.session();
  if (!session) {
    return router.createUrlTree(['/login']);
  }

  // Fetch the user's active status and joined role name from Supabase.
  const { data, error } = await supabase
    .from('users')
    .select('is_active, roles!inner(name)')
    .eq('id', session.user.id)
    .single();

  const role = Array.isArray(data?.roles) ? data.roles[0] : data?.roles;

  if (error || !data || data.is_active !== true || role?.name !== 'ADMIN') {
    return router.createUrlTree(['/dashboard']);
  }

  return true;
};
