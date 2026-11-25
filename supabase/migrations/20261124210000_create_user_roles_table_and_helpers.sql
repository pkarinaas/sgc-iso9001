-- Migration: Multi-Role Join Table (user_roles), Historical Backfill, Baseline RLS, and Helper Functions
-- Implements to transition user role assignment from 1:1 (public.users.role_id)
-- to N:M (public.user_roles) while preserving backward compatibility for existing RLS policies and queries.

-- 1. Create public.user_roles join table
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role_id INT NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

COMMENT ON TABLE public.user_roles IS
    'Join table mapping users to one or more SGC-ISO9001 roles (N:M relationship).';

COMMENT ON COLUMN public.user_roles.user_id IS
    'Reference to public.users(id); removes role assignments automatically when the user is deleted.';

COMMENT ON COLUMN public.user_roles.role_id IS
    'Reference to public.roles(id); restricts deleting roles that are still assigned to users.';

COMMENT ON COLUMN public.user_roles.created_at IS
    'Timestamp when the role assignment was created.';

-- 2. Performance indexes for user-centric and role-centric lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
    ON public.user_roles (user_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_id
    ON public.user_roles (role_id);

-- 3. Idempotent historical backfill from public.users.role_id
INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, u.role_id
FROM public.users u
WHERE u.role_id IS NOT NULL
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 4. Multi-role SECURITY DEFINER helper functions (safe empty search_path)
CREATE OR REPLACE FUNCTION public.get_current_user_roles()
RETURNS TEXT[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(ARRAY_AGG(r.name::TEXT ORDER BY r.id), ARRAY[]::TEXT[])
    FROM public.user_roles ur
    JOIN public.users u ON u.id = ur.user_id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND u.is_active = TRUE;
$$;

COMMENT ON FUNCTION public.get_current_user_roles() IS
    'Returns the active role names assigned to the authenticated user (auth.uid()) as a TEXT array.';

CREATE OR REPLACE FUNCTION public.has_role(target_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(target_role = ANY(public.get_current_user_roles()), FALSE);
$$;

COMMENT ON FUNCTION public.has_role(TEXT) IS
    'Returns TRUE if the authenticated active user holds the specified role name.';

CREATE OR REPLACE FUNCTION public.has_any_role(target_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(public.get_current_user_roles() && target_roles, FALSE);
$$;

COMMENT ON FUNCTION public.has_any_role(TEXT[]) IS
    'Returns TRUE if the authenticated active user holds at least one of the specified role names.';

GRANT EXECUTE ON FUNCTION public.get_current_user_roles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(TEXT[]) TO authenticated, service_role;

-- 5. Enable Row Level Security and define baseline access policies on public.user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_roles FROM anon, public;
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- Authenticated users can read their own role assignments; ADMIN users can read all assignments
DROP POLICY IF EXISTS "user_roles_select_policy" ON public.user_roles;
CREATE POLICY "user_roles_select_policy"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.has_role('ADMIN')
);

-- Only active ADMIN users can assign roles
DROP POLICY IF EXISTS "user_roles_insert_policy" ON public.user_roles;
CREATE POLICY "user_roles_insert_policy"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_role('ADMIN')
);

-- Only active ADMIN users can revoke role assignments
DROP POLICY IF EXISTS "user_roles_delete_policy" ON public.user_roles;
CREATE POLICY "user_roles_delete_policy"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
    public.has_role('ADMIN')
);
