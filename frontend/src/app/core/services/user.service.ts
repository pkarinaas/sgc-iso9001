import { Injectable, signal } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabase/supabase.client';
import { environment } from '../../../environments/environment';
import {
  extractRoleNames,
  ROLE_PRIORITY,
  type Role,
  type User,
  type CreateUserPayload,
  type UpdateUserPayload,
} from '../models/user.model';

/**
 * UserService manages the reactive state for the Users & Roles feature.
 *
 * All state is exposed as read-only Angular Signals so that components can
 * bind directly without manual subscriptions.
 */
@Injectable({ providedIn: 'root' })
export class UserService {
  /**
   * Explicit PostgREST select disambiguating the direct `users_role_id_fkey`
   * relationship from the N:M `user_roles` relationship to prevent `PGRST201`.
   */
  private static readonly USER_WITH_ROLES_SELECT =
    'id, email, full_name, role_id, is_active, created_at, assigned_processes, roles:roles!users_role_id_fkey(id, name, description), user_roles(role_id, roles(id, name))';

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
   * Uses explicit foreign-key disambiguation (`users_role_id_fkey`) and `user_roles`
   * to avoid PostgREST `PGRST201` ambiguity while normalizing `roles` and `roleNames`.
   */
  async loadUsers(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    const { data, error } = await supabase
      .from('users')
      .select(UserService.USER_WITH_ROLES_SELECT)
      .order('full_name', { ascending: true });

    if (error) {
      this._error.set(error.message);
    } else {
      const rows = (data as unknown as User[]) ?? [];
      this._users.set(rows.map((row) => this.normalizeUser(row)));
    }

    this._loading.set(false);
  }

  /**
   * Fetches an individual user's profile by their UUID.
   *
   * @param userId - UUID of the user.
   * @returns The User object or null.
   */
  async getUserProfile(userId: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select(UserService.USER_WITH_ROLES_SELECT)
      .eq('id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.normalizeUser(data as unknown as User);
  }

  private normalizeUser(raw: User): User {
    const rawRoles = raw.roles as Role | Role[] | null | undefined;
    let legacyRole: Role | null = Array.isArray(rawRoles)
      ? (rawRoles[0] ?? null)
      : (rawRoles ?? null);
    const roleNames = extractRoleNames({
      user_roles: raw.user_roles,
      roles: legacyRole,
      roleNames: raw.roleNames,
    });

    if (!legacyRole && roleNames.length > 0 && Array.isArray(raw.user_roles)) {
      const primaryName = roleNames[0];
      for (const relation of raw.user_roles) {
        const relRoles = relation?.roles;
        const candidates = Array.isArray(relRoles) ? relRoles : relRoles ? [relRoles] : [];
        const match = candidates.find((r) => r.name?.trim().toUpperCase() === primaryName);
        if (match) {
          legacyRole = {
            id: match.id,
            name: match.name,
            description: null,
            created_at: '',
          };
          break;
        }
      }
    }

    return {
      ...raw,
      roles: legacyRole,
      roleNames,
    };
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
    const roleIds = this.normalizeRoleIds(payload.role_ids, payload.role_id);
    if (roleIds.length === 0) {
      return { error: 'Debe seleccionar al menos un rol.' };
    }
    const primaryRoleId = this.resolvePrimaryRoleId(roleIds);

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
      role_id: primaryRoleId,
      assigned_processes: payload.assigned_processes ?? [],
      is_active: true,
    });

    if (insertError) {
      return { error: insertError.message };
    }

    // Step 3: Persist all selected roles in public.user_roles.
    const rolesSyncResult = await this.syncUserRoles(newUserId, roleIds, false);
    if (rolesSyncResult.error) {
      return rolesSyncResult;
    }

    // Refresh the in-memory user list.
    await this.loadUsers();
    return { error: null };
  }

  /**
   * Updates mutable fields (`full_name`, `role_id`, `assigned_processes`) and synchronizes
   * `public.user_roles` for an existing user.
   *
   * @param userId  - UUID of the user record to update.
   * @param payload - The new values for `full_name`, `role_ids`, and `assigned_processes`.
   * @returns An object whose `error` property is null on success.
   */
  async updateUser(userId: string, payload: UpdateUserPayload): Promise<{ error: string | null }> {
    const roleIds = this.normalizeRoleIds(payload.role_ids, payload.role_id);
    if (roleIds.length === 0) {
      return { error: 'Debe seleccionar al menos un rol.' };
    }
    const primaryRoleId = this.resolvePrimaryRoleId(roleIds);

    const updateData: Record<string, unknown> = {
      full_name: payload.full_name,
      role_id: primaryRoleId,
    };

    if (payload.assigned_processes !== undefined) {
      updateData['assigned_processes'] = payload.assigned_processes;
    }

    const { error } = await supabase.from('users').update(updateData).eq('id', userId);

    if (error) {
      return { error: error.message };
    }

    const rolesSyncResult = await this.syncUserRoles(userId, roleIds, true);
    if (rolesSyncResult.error) {
      return rolesSyncResult;
    }

    // Refresh the in-memory user list.
    await this.loadUsers();
    return { error: null };
  }

  private normalizeRoleIds(roleIds?: readonly number[], legacyRoleId?: number | null): number[] {
    const unique = new Set<number>();
    if (Array.isArray(roleIds)) {
      for (const id of roleIds) {
        if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
          unique.add(id);
        }
      }
    }
    if (
      unique.size === 0 &&
      typeof legacyRoleId === 'number' &&
      Number.isFinite(legacyRoleId) &&
      legacyRoleId > 0
    ) {
      unique.add(legacyRoleId);
    }
    return Array.from(unique);
  }

  private resolvePrimaryRoleId(roleIds: readonly number[]): number {
    const catalog = this._roles();
    if (catalog.length === 0) {
      return roleIds[0];
    }

    let bestId = roleIds[0];
    let bestRank = Number.MAX_SAFE_INTEGER;

    for (const id of roleIds) {
      const role = catalog.find((r) => r.id === id);
      if (!role) {
        continue;
      }
      const index = ROLE_PRIORITY.indexOf(role.name);
      const rank = index === -1 ? ROLE_PRIORITY.length : index;
      if (rank < bestRank) {
        bestRank = rank;
        bestId = id;
      }
    }

    return bestId;
  }

  /**
   * Synchronizes `public.user_roles` in RLS-safe order: upserts desired roles first
   * before pruning stale rows so an administrator cannot lock themselves out mid-update.
   */
  private async syncUserRoles(
    userId: string,
    roleIds: readonly number[],
    removeStale: boolean,
  ): Promise<{ error: string | null }> {
    const rows = roleIds.map((roleId) => ({
      user_id: userId,
      role_id: roleId,
    }));

    const { error: upsertError } = await supabase
      .from('user_roles')
      .upsert(rows, { onConflict: 'user_id,role_id', ignoreDuplicates: true });

    if (upsertError) {
      return { error: upsertError.message };
    }

    if (removeStale) {
      const { error: deleteError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .not('role_id', 'in', `(${roleIds.join(',')})`);

      if (deleteError) {
        return { error: deleteError.message };
      }
    }

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
