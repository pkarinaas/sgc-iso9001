-- Migration: Document Row-Level Security (RLS) Policies

-- 1. Helper function to get the current authenticated user's role name
-- (Uses SECURITY DEFINER to avoid infinite recursion and ensure consistent access)
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
  SELECT r.name
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  WHERE u.id = auth.uid()
    AND u.is_active = TRUE
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated;

-- 2. Ensure RLS is enabled on public.documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing document policies
DROP POLICY IF EXISTS "Permitir lectura de documentos a usuarios autenticados" ON public.documents;
DROP POLICY IF EXISTS "Permitir crear documentos a usuarios autenticados" ON public.documents;
DROP POLICY IF EXISTS "Permitir actualizar documentos a usuarios autenticados" ON public.documents;
DROP POLICY IF EXISTS "documents_select_policy" ON public.documents;
DROP POLICY IF EXISTS "documents_insert_policy" ON public.documents;
DROP POLICY IF EXISTS "documents_update_policy" ON public.documents;
DROP POLICY IF EXISTS "documents_delete_policy" ON public.documents;

-- 4. SELECT Policy
-- VIEWER can only view 'APPROVED' documents.
-- ADMIN, EDITOR, REVIEWER, and APPROVER can view all documents.
CREATE POLICY "documents_select_policy"
ON public.documents
FOR SELECT
TO authenticated
USING (
  public.get_current_user_role() IN ('ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER')
  OR (
    public.get_current_user_role() = 'VIEWER'
    AND status = 'APPROVED'
  )
);

-- 5. INSERT Policy
-- ADMIN, EDITOR, REVIEWER, and APPROVER can insert, provided initial status is 'DRAFT'.
-- VIEWER cannot insert.
CREATE POLICY "documents_insert_policy"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (
  public.get_current_user_role() IN ('ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER')
  AND status = 'DRAFT'
);

-- 6. UPDATE Policy
-- Enforces allowed transitions based on current document status:
--   - EDITOR: only current status 'DRAFT'
--   - REVIEWER: current status 'DRAFT' or 'REVIEWED'
--   - APPROVER: current status 'REVIEWED' or 'APPROVED'
--   - ADMIN: any current status
--   - VIEWER: cannot update
CREATE POLICY "documents_update_policy"
ON public.documents
FOR UPDATE
TO authenticated
USING (
  CASE public.get_current_user_role()
    WHEN 'ADMIN' THEN TRUE
    WHEN 'EDITOR' THEN status = 'DRAFT'
    WHEN 'REVIEWER' THEN status IN ('DRAFT', 'REVIEWED')
    WHEN 'APPROVER' THEN status IN ('REVIEWED', 'APPROVED')
    ELSE FALSE
  END
)
WITH CHECK (
  public.get_current_user_role() IN ('ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER')
);

-- 7. DELETE Policy
-- ADMIN, EDITOR, REVIEWER, and APPROVER can delete only if current status is 'DRAFT' or 'REVIEWED'.
-- Traceability rule: NO ONE (including ADMIN) can delete 'APPROVED' or 'OBSOLETE' documents.
CREATE POLICY "documents_delete_policy"
ON public.documents
FOR DELETE
TO authenticated
USING (
  public.get_current_user_role() IN ('ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER')
  AND status IN ('DRAFT', 'REVIEWED')
);
