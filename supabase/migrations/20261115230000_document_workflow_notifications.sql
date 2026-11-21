-- Migration: Document Workflow Automated Notifications Trigger

-- 1. Ensure public.users has columns for process_area and role if not already present
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS process_area TEXT;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS role TEXT;

-- 2. Trigger Function: handle_document_status_change
CREATE OR REPLACE FUNCTION public.handle_document_status_change()
RETURNS TRIGGER AS $$
BEGIN

  -- Transition 1 (Draft / Borrador):
  -- When a document is created as or transitions to 'DRAFT' / 'Borrador',
  -- notify all users with role 'REVIEWER' assigned to the document's process area.

  IF (NEW.status IN ('DRAFT', 'Borrador')) THEN
    IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.status IS NULL OR OLD.status NOT IN ('DRAFT', 'Borrador')))) THEN
      INSERT INTO public.notifications (user_id, document_id, type, message)
      SELECT
          u.id,
          NEW.id,
          'REVIEW_REQUIRED',
          'Hay un nuevo borrador pendiente de revisión'
      FROM public.users u
      LEFT JOIN public.roles r ON u.role_id = r.id
      WHERE (r.name = 'REVIEWER' OR u.role = 'REVIEWER')
        AND (u.is_active IS TRUE OR u.is_active IS NULL)
        AND (
            NEW.process_area IS NULL
            OR NEW.process_area = ''
            OR u.process_area = NEW.process_area
            OR NEW.process_area = ANY(u.assigned_processes)
        );
    END IF;
  END IF;

  -- Transition 2 (Reviewed / Revisado):
  -- When a document transitions to 'REVIEWED' / 'Revisado',
  -- notify all users with role 'APPROVER' assigned to the document's process area.

  IF (NEW.status IN ('REVIEWED', 'Revisado')) THEN
    IF (TG_OP = 'UPDATE' AND (OLD.status IS NULL OR OLD.status NOT IN ('REVIEWED', 'Revisado'))) THEN
      INSERT INTO public.notifications (user_id, document_id, type, message)
      SELECT
          u.id,
          NEW.id,
          'APPROVAL_REQUIRED',
          'Un documento ha sido revisado y requiere su aprobación'
      FROM public.users u
      LEFT JOIN public.roles r ON u.role_id = r.id
      WHERE (r.name = 'APPROVER' OR u.role = 'APPROVER')
        AND (u.is_active IS TRUE OR u.is_active IS NULL)
        AND (
            NEW.process_area IS NULL
            OR NEW.process_area = ''
            OR u.process_area = NEW.process_area
            OR NEW.process_area = ANY(u.assigned_processes)
        );
    END IF;
  END IF;

  -- Transition 3 (Approved / Aprobado):
  -- When a document transitions to 'APPROVED' / 'Aprobado',
  -- notify all users with role 'VIEWER' assigned to the document's process area.

  IF (NEW.status IN ('APPROVED', 'Aprobado')) THEN
    IF (TG_OP = 'UPDATE' AND (OLD.status IS NULL OR OLD.status NOT IN ('APPROVED', 'Aprobado'))) THEN
      INSERT INTO public.notifications (user_id, document_id, type, message)
      SELECT
          u.id,
          NEW.id,
          'DOCUMENT_APPROVED',
          'Se ha publicado un nuevo documento aprobado'
      FROM public.users u
      LEFT JOIN public.roles r ON u.role_id = r.id
      WHERE (r.name = 'VIEWER' OR u.role = 'VIEWER')
        AND (u.is_active IS TRUE OR u.is_active IS NULL)
        AND (
            NEW.process_area IS NULL
            OR NEW.process_area = ''
            OR u.process_area = NEW.process_area
            OR NEW.process_area = ANY(u.assigned_processes)
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.handle_document_status_change() IS
    'Automates notification dispatch on document workflow status transitions (REVIEW_REQUIRED, APPROVAL_REQUIRED, DOCUMENT_APPROVED).';

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.handle_document_status_change() TO authenticated, service_role;

-- 3. Trigger: on_document_workflow_update
DROP TRIGGER IF EXISTS on_document_workflow_update ON public.documents;
CREATE TRIGGER on_document_workflow_update
AFTER INSERT OR UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.handle_document_status_change();
