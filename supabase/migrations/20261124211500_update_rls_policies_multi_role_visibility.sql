-- Migration: Multi-Role Helpers, Process Visibility Matrix, and Complete RLS Migration
-- Implements to transition all RLS policies across public.* and storage.objects
-- from single-role lookups (get_current_user_role / is_admin via users.role_id) to multi-role helpers
-- (public.has_role / public.has_any_role via public.user_roles) and enforces the ISO 9001 visibility matrix.

-- 1. Active User & Process-Assignment Helper Functions (SECURITY DEFINER, safe empty search_path)
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.is_active = TRUE
    );
$$;

COMMENT ON FUNCTION public.is_active_user() IS
    'Returns TRUE if the current authenticated user (auth.uid()) exists in public.users and is active.';

CREATE OR REPLACE FUNCTION public.user_has_process(target_process TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.is_active = TRUE
          AND target_process IS NOT NULL
          AND BTRIM(target_process) <> ''
          AND (
              target_process = ANY(COALESCE(u.assigned_processes, ARRAY[]::TEXT[]))
              OR u.process_area = target_process
          )
    );
$$;

COMMENT ON FUNCTION public.user_has_process(TEXT) IS
    'Returns TRUE if the active authenticated user is assigned to the given document process_area.';

-- 2. Backward-Compatibility Wrappers (sourced from public.user_roles while preserving legacy callers)
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT r.name::TEXT
    FROM public.user_roles ur
    JOIN public.users u ON u.id = ur.user_id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND u.is_active = TRUE
    ORDER BY
        CASE r.name
            WHEN 'ADMIN' THEN 1
            WHEN 'APPROVER' THEN 2
            WHEN 'REVIEWER' THEN 3
            WHEN 'EDITOR' THEN 4
            WHEN 'VIEWER' THEN 5
            WHEN 'READER' THEN 6
            ELSE 7
        END,
        r.id
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_current_user_role() IS
    'Backward-compatibility helper returning the highest-priority active role from public.user_roles.';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT public.has_role('ADMIN');
$$;

COMMENT ON FUNCTION public.is_admin() IS
    'Backward-compatibility helper delegating to public.has_role(''ADMIN'').';

GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_process(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- 3. Update public.documents RLS Policies (Multi-Role + ISO 9001 Status/Process Visibility Matrix)
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_select_policy" ON public.documents;
CREATE POLICY "documents_select_policy"
ON public.documents
FOR SELECT
TO authenticated
USING (
    public.has_role('ADMIN')
    OR (
        status = 'DRAFT'
        AND public.has_role('REVIEWER')
        AND public.user_has_process(process_area)
    )
    OR (
        status = 'REVIEWED'
        AND public.has_role('APPROVER')
        AND public.user_has_process(process_area)
    )
    OR (
        status = 'APPROVED'
        AND public.is_active_user()
    )
    OR (
        status IN ('OBSOLETE', 'DISCONTINUED')
        AND public.has_any_role(ARRAY['ADMIN', 'APPROVER'])
    )
);

DROP POLICY IF EXISTS "documents_insert_policy" ON public.documents;
CREATE POLICY "documents_insert_policy"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_any_role(ARRAY['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER'])
    AND status = 'DRAFT'
);

DROP POLICY IF EXISTS "documents_update_policy" ON public.documents;
CREATE POLICY "documents_update_policy"
ON public.documents
FOR UPDATE
TO authenticated
USING (
    public.has_role('ADMIN')
    OR (public.has_role('EDITOR') AND status = 'DRAFT')
    OR (public.has_role('REVIEWER') AND status IN ('DRAFT', 'REVIEWED'))
    OR (public.has_role('APPROVER') AND status IN ('REVIEWED', 'APPROVED'))
)
WITH CHECK (
    public.has_any_role(ARRAY['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER'])
);

DROP POLICY IF EXISTS "documents_delete_policy" ON public.documents;
CREATE POLICY "documents_delete_policy"
ON public.documents
FOR DELETE
TO authenticated
USING (
    public.has_any_role(ARRAY['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER'])
    AND status IN ('DRAFT', 'REVIEWED')
);

-- 4. Update public.users RLS Policies (replace legacy single-role admin checks with public.has_role)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admins to insert users" ON public.users;
CREATE POLICY "Allow admins to insert users"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_role('ADMIN')
);

DROP POLICY IF EXISTS "Allow admins to update users" ON public.users;
CREATE POLICY "Allow admins to update users"
ON public.users
FOR UPDATE
TO authenticated
USING (
    public.has_role('ADMIN')
)
WITH CHECK (
    public.has_role('ADMIN')
);

-- 5. Update public.audit_logs RLS Policy (preserve strict read-only immutability)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select_policy" ON public.audit_logs;
CREATE POLICY "audit_logs_select_policy"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    public.has_any_role(ARRAY['ADMIN', 'APPROVER'])
);

-- 6. Update public.document_acknowledgements RLS Policy (preserve insert policy and immutability)
ALTER TABLE public.document_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_acknowledgements_select_policy" ON public.document_acknowledgements;
CREATE POLICY "document_acknowledgements_select_policy"
ON public.document_acknowledgements
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.has_any_role(ARRAY['ADMIN', 'APPROVER'])
);

-- 7. Update storage.objects RLS Policies for bucket 'sgc-files'
DROP POLICY IF EXISTS "Permitir subida a usuarios autenticados" ON storage.objects;
DROP POLICY IF EXISTS "Permitir actualización de archivos a usuarios autenticados" ON storage.objects;
DROP POLICY IF EXISTS "Permitir lectura de archivos a usuarios autenticados" ON storage.objects;
DROP POLICY IF EXISTS "storage_sgc_files_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "storage_sgc_files_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "storage_sgc_files_update_policy" ON storage.objects;
DROP POLICY IF EXISTS "storage_sgc_files_delete_policy" ON storage.objects;

CREATE POLICY "storage_sgc_files_select_policy"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'sgc-files'
    AND public.is_active_user()
);

CREATE POLICY "storage_sgc_files_insert_policy"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'sgc-files'
    AND public.has_any_role(ARRAY['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER'])
);

CREATE POLICY "storage_sgc_files_update_policy"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'sgc-files'
    AND public.has_any_role(ARRAY['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER'])
)
WITH CHECK (
    bucket_id = 'sgc-files'
    AND public.has_any_role(ARRAY['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER'])
);

CREATE POLICY "storage_sgc_files_delete_policy"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'sgc-files'
    AND public.has_any_role(ARRAY['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER'])
);
