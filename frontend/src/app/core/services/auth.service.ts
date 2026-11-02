import { inject, signal, computed, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import type { Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../supabase/supabase.client';

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

  /** Writable signal holding the current user's role name. */
  private readonly _userRole = signal<string | null>(null);

  /** Public read-only view of the current user's role. */
  readonly userRole = this._userRole.asReadonly();

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
        this._userRole.set(null);
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
    // Update the session signal immediately so the rest of the app
    // reflects the authenticated state before the caller continues.
    this._session.set(data.session);
    return { session: data.session, error };
  }

  /**
   * Retrieves the current user's role from the public.users table.
   * Caches the value in the `_userRole` signal.
   *
   * @returns The role name ('ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER', 'VIEWER') or null.
   */
  async getUserRole(): Promise<string | null> {
    if (this._userRole()) {
      return this._userRole();
    }
    await this.waitForInitialization();
    const session = this._session();
    if (!session) {
      this._userRole.set(null);
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('roles(name)')
        .eq('id', session.user.id)
        .single();

      if (error || !data) {
        this._userRole.set(null);
        return null;
      }

      const roleName = Array.isArray(data.roles)
        ? data.roles[0]?.name
        : (data.roles as any)?.name;

      const roleStr = roleName ?? null;
      this._userRole.set(roleStr);
      return roleStr;
    } catch {
      this._userRole.set(null);
      return null;
    }
  }

  /** Signs the current user out and navigates to the login page. */
  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this._session.set(null);
    this._userRole.set(null);
    await this.router.navigate(['/login']);
  }
}
