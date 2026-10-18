import { inject, signal, computed, Service } from '@angular/core';
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
 */
@Service()
export class AuthService {
  private readonly router = inject(Router);

  /** Writable signal holding the current Supabase session (null = unauthenticated). */
  private readonly _session = signal<Session | null>(null);

  /** Public read-only view of the current session. */
  readonly session = this._session.asReadonly();

  /** Derived boolean Signal: true when the user has an active session. */
  readonly isAuthenticated = computed(() => this._session() !== null);

  constructor() {
    // Hydrate session on service initialization (handles page reload).
    supabase.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
    });

    // Keep the session Signal in sync with Supabase auth state changes.
    supabase.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
    });
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
    return { session: data.session, error };
  }

  /** Signs the current user out and navigates to the login page. */
  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
