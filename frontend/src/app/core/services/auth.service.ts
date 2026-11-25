import { inject, signal, computed, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import type { Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../supabase/supabase.client';
import {
  extractRoleNames,
  type Role,
  type User,
  type UserRoleRelation,
} from '../models/user.model';

export interface SignInResult {
  session: Session | null;
  error: AuthError | null;
}

/**
 * AuthService manages authentication state via Supabase and exposes
 * the active session as a reactive Signal for the rest of the application.
 *
 * Initialization flow:
 *   1. `getSession()` hydrates the session from the persisted token on startup
 *      (critical for page reloads / F5).
 *   2. `onAuthStateChange()` keeps the signal in sync for every subsequent
 *      sign-in / sign-out event.
 *   3. `_initialized` flips to `true` once step 1 completes, and
 *      `waitForInitialization()` lets the `authGuard` await that moment
 *      without a race condition.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);

  /** Writable signal holding the current Supabase session (null = unauthenticated). */
  private readonly _session = signal<Session | null>(null);

  /**
   * Tracks whether the initial `getSession()` hydration has completed.
   * Guards must await this before evaluating `isAuthenticated()` on page reload.
   */
  private readonly _initialized = signal<boolean>(false);

  /** Public read-only view of the current session. */
  readonly session = this._session.asReadonly();

  /** Public read-only view of the initialization state. */
  readonly initialized = this._initialized.asReadonly();

  /** Derived boolean Signal: true when the user has an active session. */
  readonly isAuthenticated = computed(() => this._session() !== null);

  /** Writable signal holding all active role names assigned to the current user. */
  private readonly _userRoles = signal<string[]>([]);

  /** Public read-only view of all role names assigned to the current user. */
  readonly userRoles = this._userRoles.asReadonly();

  /** Public read-only view of the user's highest-priority role (backward compatibility). */
  readonly userRole = computed<string | null>(() => this._userRoles()[0] ?? null);

  /** Writable signal holding the current user profile data. */
  private readonly _currentUser = signal<User | null>(null);

  /** Public read-only view of the current user profile data. */
  readonly currentUser = this._currentUser.asReadonly();

  /**
   * Promise that resolves once the initial `getSession()` call completes.
   */
  private readonly initPromise: Promise<void>;

  constructor() {
    // Hydrate session on service initialization (handles page reload / F5).
    // Store the promise so guards can await it before evaluating auth state.
    this.initPromise = supabase.auth
      .getSession()
      .then(({ data }) => {
        this._session.set(data.session);
        this._initialized.set(true);
      })
      .catch(() => {
        this._session.set(null);
        this._initialized.set(true);
      });

    // Keep the session Signal in sync with Supabase auth state changes.
    supabase.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
      if (!session) {
        this._userRoles.set([]);
        this._currentUser.set(null);
      }
      this._initialized.set(true);
    });
  }

  /**
   * Waits until the initial session hydration has finished.
   * Call this in the `authGuard` before reading `isAuthenticated()` to
   * eliminate the race condition that occurs on page reload (F5).
   *
   * No-ops immediately when `_initialized` is already `true`.
   */
  async waitForInitialization(): Promise<void> {
    if (!this._initialized()) {
      await this.initPromise;
    }
  }

  /**
   * Authenticates the user with email and password via Supabase.
   * Supabase internally records each attempt in auth.audit_log_entries,
   * satisfying ISO 9001 access-audit requirements without a custom backend.
   *
   * @param email    - The user's email address.
   * @param password - The user's plaintext password.
   * @returns        - An object containing the resulting session or an error.
   */
  async signIn(email: string, password: string): Promise<SignInResult> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    // Reset cached profile/roles and update the session signal immediately so the rest
    // of the app reflects the newly authenticated state before the caller continues.
    this._userRoles.set([]);
    this._currentUser.set(null);
    this._session.set(data.session);
    return { session: data.session, error };
  }

  /**
   * Returns `true` if the current authenticated user holds the specified role.
   */
  hasRole(role: string): boolean {
    const normalized = role.trim().toUpperCase();
    if (!normalized) {
      return false;
    }
    return this._userRoles().includes(normalized);
  }

  /**
   * Returns `true` if the current authenticated user holds at least one of the specified roles.
   */
  hasAnyRole(roles: readonly string[]): boolean {
    return roles.some((role) => this.hasRole(role));
  }

  private async fetchUserRolesRelations(userId: string): Promise<UserRoleRelation[]> {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role_id, roles(id, name)')
      .eq('user_id', userId);

    if (error || !Array.isArray(data)) {
      return [];
    }
    return data as unknown as UserRoleRelation[];
  }

  private async fetchLegacyRoleById(roleId: number): Promise<Role | null> {
    const { data, error } = await supabase
      .from('roles')
      .select('id, name, description, created_at')
      .eq('id', roleId)
      .single();

    if (error || !data) {
      return null;
    }
    return data as unknown as Role;
  }

  /**
   * Retrieves all active role names assigned to the current user from `public.user_roles`
   * (with fallback to legacy `public.users.role_id` -> `public.roles`), caching them in `_userRoles`.
   */
  async getUserRoles(): Promise<string[]> {
    if (this._userRoles().length > 0) {
      return this._userRoles();
    }
    await this.waitForInitialization();
    const session = this._session();
    if (!session) {
      this._userRoles.set([]);
      return [];
    }

    try {
      const userRoles = await this.fetchUserRolesRelations(session.user.id);
      let roleNames = extractRoleNames({ user_roles: userRoles });

      if (roleNames.length === 0) {
        const { data: userData } = await supabase
          .from('users')
          .select('role_id')
          .eq('id', session.user.id)
          .single();

        if (userData?.role_id !== null && userData?.role_id !== undefined) {
          const legacyRole = await this.fetchLegacyRoleById(Number(userData.role_id));
          roleNames = extractRoleNames({ roles: legacyRole });
        }
      }

      this._userRoles.set(roleNames);
      return roleNames;
    } catch {
      this._userRoles.set([]);
      return [];
    }
  }

  /**
   * Retrieves the current user's highest-priority role name for backward compatibility.
   *
   * @returns The primary role name ('ADMIN', 'APPROVER', 'REVIEWER', 'EDITOR', 'VIEWER') or null.
   */
  async getUserRole(): Promise<string | null> {
    const roles = await this.getUserRoles();
    return roles[0] ?? null;
  }

  /**
   * Retrieves the current user's profile from `public.users` and assigned roles from
   * `public.user_roles` using separate queries to avoid PostgREST embed ambiguity,
   * caching the result in `_currentUser` and `_userRoles`.
   *
   * @returns The User object or null if unauthenticated or not found.
   */
  async getCurrentUserProfile(): Promise<User | null> {
    if (this._currentUser()) {
      return this._currentUser();
    }
    await this.waitForInitialization();
    const session = this._session();
    if (!session?.user) {
      this._currentUser.set(null);
      this._userRoles.set([]);
      return null;
    }

    try {
      const [userResult, userRoles] = await Promise.all([
        supabase
          .from('users')
          .select('id, email, full_name, role_id, is_active, created_at, assigned_processes')
          .eq('id', session.user.id)
          .single(),
        this.fetchUserRolesRelations(session.user.id),
      ]);

      if (userResult.error || !userResult.data) {
        this._currentUser.set(null);
        this._userRoles.set([]);
        return null;
      }

      const rawUser = userResult.data as unknown as User;
      let legacyRole: Role | null = null;
      let roleNames = extractRoleNames({ user_roles: userRoles });

      if (roleNames.length === 0 && rawUser.role_id !== null && rawUser.role_id !== undefined) {
        legacyRole = await this.fetchLegacyRoleById(rawUser.role_id);
        roleNames = extractRoleNames({ roles: legacyRole });
      }

      this._userRoles.set(roleNames);

      const profile: User = {
        ...rawUser,
        roles: legacyRole,
        user_roles: userRoles,
        roleNames,
      };
      this._currentUser.set(profile);
      return profile;
    } catch {
      this._currentUser.set(null);
      this._userRoles.set([]);
      return null;
    }
  }

  /** Signs the current user out and navigates to the login page. */
  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this._session.set(null);
    this._userRoles.set([]);
    this._currentUser.set(null);
    await this.router.navigate(['/login']);
  }
}
