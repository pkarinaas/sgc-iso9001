import { Injectable, signal } from '@angular/core';
import { supabase } from '../supabase/supabase.client';
import type { Role, User } from '../models/user.model';

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
   * Opens the edit dialog for a given user.
   *
   * @param user - The user record to edit.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  editUser(_user: User): void {
    // TODO: Emit the selected user to the edit dialog.
  }

  /**
   * Toggles the `is_active` flag for a given user.
   *
   * @param user - The user record whose status should be toggled.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  toggleUserStatus(_user: User): void {
    // TODO: Call supabase.from('users').update({ is_active: !user.is_active })
    //                   .eq('id', user.id) and reload the user list.
  }
}
