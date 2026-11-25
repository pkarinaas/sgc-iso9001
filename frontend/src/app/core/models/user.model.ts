/**
 * Domain models for the Users & Roles.
 * These interfaces mirror the public.roles and public.users tables in Supabase.
 */

/** Represents a row in the public.roles table. */
export interface Role {
  id: number;
  name: 'ADMIN' | 'EDITOR' | 'REVIEWER' | 'APPROVER' | 'VIEWER';
  description: string | null;
  created_at: string;
}

/** Represents a row from the public.user_roles join table with nested role details. */
export interface UserRoleRelation {
  role_id?: number;
  roles?: Pick<Role, 'id' | 'name'> | Pick<Role, 'id' | 'name'>[] | null;
}

/** Priority order used when determining a primary display/fallback role. */
export const ROLE_PRIORITY: readonly string[] = [
  'ADMIN',
  'APPROVER',
  'REVIEWER',
  'EDITOR',
  'VIEWER',
  'READER',
];

/** Maps internal database role codes to their Spanish UI labels. */
export const ROLE_LABELS_ES: Record<string, string> = {
  ADMIN: 'Administrador',
  APPROVER: 'Aprobador',
  REVIEWER: 'Revisor',
  EDITOR: 'Editor',
  VIEWER: 'Lector',
  READER: 'Lector',
};

/**
 * Represents a row in the public.users table.
 * Includes optional multi-role `user_roles` relations, normalized `roleNames`,
 * and the legacy single `roles` join for backward compatibility.
 */
export interface User {
  id: string;
  email: string;
  full_name: string;
  role_id: number | null;
  /** Process areas assigned to the user for document visibility and reading obligations. */
  assigned_processes?: string[];
  is_active: boolean;
  created_at: string;
  /** Legacy nested role object returned by the Supabase single-role join. */
  roles?: Role | null;
  /** Multi-role relations joined from public.user_roles(role_id, roles(id, name)). */
  user_roles?: UserRoleRelation[] | null;
  /** Normalized, deduplicated, priority-sorted role names derived from user_roles. */
  roleNames?: string[];
}

/** Joined role relation returned by Supabase PostgREST queries (object, array, or null). */
export type RoleRelation = Pick<Role, 'name'> | Pick<Role, 'name'>[] | null | undefined;

/** Accepted inputs for extracting normalized role names from User or PostgREST payloads. */
export type RoleSource =
  | {
      user_roles?: UserRoleRelation[] | null;
      roles?: RoleRelation | Role | null;
      roleNames?: string[];
    }
  | RoleRelation
  | null
  | undefined;

function collectRoleRelationNames(roles: RoleRelation, target: Set<string>): void {
  if (!roles) {
    return;
  }
  const items = Array.isArray(roles) ? roles : [roles];
  for (const item of items) {
    const normalized = item?.name?.trim().toUpperCase();
    if (normalized) {
      target.add(normalized);
    }
  }
}

/**
 * Extracts all unique, normalized role names from `user_roles` (falling back to
 * `roleNames` or the legacy single `roles` relation) ordered by `ROLE_PRIORITY`.
 */
export function extractRoleNames(source: RoleSource): string[] {
  if (!source) {
    return [];
  }

  const uniqueRoles = new Set<string>();

  if (Array.isArray(source)) {
    collectRoleRelationNames(source, uniqueRoles);
  } else {
    if ('user_roles' in source && Array.isArray(source.user_roles)) {
      for (const relation of source.user_roles) {
        collectRoleRelationNames(relation?.roles, uniqueRoles);
      }
    }

    if (uniqueRoles.size === 0 && 'roleNames' in source && Array.isArray(source.roleNames)) {
      for (const roleName of source.roleNames) {
        const normalized = roleName?.trim().toUpperCase();
        if (normalized) {
          uniqueRoles.add(normalized);
        }
      }
    }

    if (uniqueRoles.size === 0 && 'roles' in source && source.roles) {
      collectRoleRelationNames(source.roles, uniqueRoles);
    }

    if (uniqueRoles.size === 0 && 'name' in source && typeof source.name === 'string') {
      collectRoleRelationNames(source, uniqueRoles);
    }
  }

  return Array.from(uniqueRoles).sort((a, b) => {
    const indexA = ROLE_PRIORITY.indexOf(a);
    const indexB = ROLE_PRIORITY.indexOf(b);
    const rankA = indexA === -1 ? ROLE_PRIORITY.length : indexA;
    const rankB = indexB === -1 ? ROLE_PRIORITY.length : indexB;
    return rankA !== rankB ? rankA - rankB : a.localeCompare(b);
  });
}

/**
 * Extracts the highest-priority role name from a User profile or joined relation
 * (`ADMIN` > `APPROVER` > `REVIEWER` > `EDITOR` > `VIEWER` > `READER`).
 */
export function extractRoleName(source: RoleSource): string | null {
  return extractRoleNames(source)[0] ?? null;
}

/**
 * Translates an internal role code (e.g. 'ADMIN') into its Spanish UI label.
 */
export function formatRoleLabel(roleName: string | null | undefined): string {
  const normalized = roleName?.trim().toUpperCase();
  if (!normalized) {
    return 'Usuario';
  }
  return ROLE_LABELS_ES[normalized] ?? roleName!.trim();
}

/**
 * Payload for creating a new user.
 * `password` is required on creation but omitted on update flows.
 */
export interface CreateUserPayload {
  email: string;
  password?: string;
  full_name: string;
  role_id: number;
  assigned_processes?: string[];
}

/**
 * Payload for updating an existing user.
 */
export interface UpdateUserPayload {
  full_name: string;
  role_id: number;
  assigned_processes?: string[];
}
