import { Injectable, signal } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabase/supabase.client';
import { environment } from '../../../environments/environment';
import type { Role, User, CreateUserPayload, UpdateUserPayload } from '../models/user.model';

/**
 * UserService manages the reactive state for the Users & Roles feature.
 *
 * All state is exposed as read-only Angular Signals so that components can
 * bind directly without manual subscriptions.
 */
@Injectable({ providedIn: 'root' })
export class UserService {
  // State signals (writable internally, read-only externally)

  private readonly _users = signal<User[]>([]);
  private readonly _roles = signal<Role[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  /** List of users returned by the last successful `loadUsers()` call. */
  readonly users = this._users.asReadonly();

  /** List of roles returned by the last successful `loadRoles()` call. */
  readonly roles = this._roles.asReadonly();

  /** True while any Supabase request is in-flight. */
  readonly loading = this._loading.asReadonly();

  /** Contains the error message of the last failed request, or null. */
  readonly error = this._error.asReadonly();

  // Data-loading methods

  /**
   * Fetches all users from `public.users` ordered alphabetically by full name.
   * The nested `roles(id, name, description)` join populates `User.roles`.
   */
  async loadUsers(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, role_id, is_active, created_at, roles(id, name, description)')
      .order('full_name', { ascending: true });

    if (error) {
      this._error.set(error.message);
    } else {
      this._users.set((data as unknown as User[]) ?? []);
    }

    this._loading.set(false);
  }

  /**
   * Fetches all roles from `public.roles` ordered by id ascending.
   * Used to populate the role filter dropdown.
   */
  async loadRoles(): Promise<void> {
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      this._error.set(error.message);
    } else {
      this._roles.set((data as Role[]) ?? []);
    }
  }

  /**
   * Creates a new user in Supabase Auth and inserts a matching row in
   * `public.users`.
   *
   * A **temporary** Supabase client (no session persistence) is used for the
   * `auth.signUp()` call so that the admin's active session is never replaced
   * by the newly created user's session.  The main `supabase` client (which
   * holds the admin JWT) is used for the `public.users` insert so that RLS
   * policies are satisfied.
   *
   * @param payload - The data required to register a new employee.
   * @returns An object whose `error` property is null on success.
   */
  async createUser(payload: CreateUserPayload): Promise<{ error: string | null }> {
    // Temporary client – isolated session so the admin stays logged in.
    const tempClient = createClient(environment.supabase.url, environment.supabase.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // Step 1: Register the new user in Supabase Auth.
    const { data: authData, error: authError } = await tempClient.auth.signUp({
      email: payload.email,
      password: payload.password!,
      options: {
        data: { full_name: payload.full_name },
      },
    });

    if (authError) {
      return { error: authError.message };
    }

    const newUserId = authData.user?.id;
    if (!newUserId) {
      return { error: 'No se pudo obtener el ID del nuevo usuario.' };
    }

    // Step 2: Insert the public profile using the admin client (RLS requires
    // the admin JWT that lives in the main `supabase` singleton).
    const { error: insertError } = await supabase.from('users').insert({
      id: newUserId,
      email: payload.email,
      full_name: payload.full_name,
      role_id: payload.role_id,
      is_active: true,
    });

    if (insertError) {
      return { error: insertError.message };
    }

    // Refresh the in-memory user list.
    await this.loadUsers();
    return { error: null };
  }

  /**
   * Updates mutable fields (`full_name`, `role_id`) for an existing user.
   *
   * @param userId  - UUID of the user record to update.
   * @param payload - The new values for `full_name` and `role_id`.
   * @returns An object whose `error` property is null on success.
   */
  async updateUser(userId: string, payload: UpdateUserPayload): Promise<{ error: string | null }> {
    const { error } = await supabase
      .from('users')
      .update({
        full_name: payload.full_name,
        role_id: payload.role_id,
      })
      .eq('id', userId);

    if (error) {
      return { error: error.message };
    }

    // Refresh the in-memory user list.
    await this.loadUsers();
    return { error: null };
  }

  /**
   * Toggles the `is_active` flag for a given user.
   *
   * @param userId - UUID of the user record whose status is to be toggled.
   * @param currentStatus - Current active status of the user.
   * @returns An object whose `error` property is null on success, or an error message string.
   */
  async toggleUserStatus(
    userId: string,
    currentStatus: boolean,
  ): Promise<{ error: string | null }> {
    const { error } = await supabase
      .from('users')
      .update({ is_active: !currentStatus })
      .eq('id', userId);

    if (error) {
      return { error: error.message };
    }

    // Refresh the in-memory user list.
    await this.loadUsers();
    return { error: null };
  }
}
