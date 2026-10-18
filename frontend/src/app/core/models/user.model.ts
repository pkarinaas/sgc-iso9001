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

/**
 * Represents a row in the public.users table.
 * The optional `roles` property is populated when the Supabase select
 * query includes a joined relation (e.g., `roles(id, name, description)`).
 */
export interface User {
  id: string;
  email: string;
  full_name: string;
  role_id: number | null;
  is_active: boolean;
  created_at: string;
  /** Nested role object returned by the Supabase join. */
  roles?: Role | null;
}
