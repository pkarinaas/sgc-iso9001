-- Migration: Include Document Code, Title, and Version in Workflow Notifications
-- Description: Replaces public.handle_document_status_change() so workflow alerts embed
-- the formatted document label "[CODE] Title (vVersion)" into the Spanish notification message.
-- Preserves existing role/process_area filtering logic and trigger attachment on public.documents.

CREATE OR REPLACE FUNCTION public.handle_document_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_code      TEXT;
  v_title     TEXT;
  v_version   TEXT;
  v_doc_label TEXT;
BEGIN
  -- Build formatted document label: [CODE] Title (vVersion)
  -- Matches UI convention (e.g., 0 -> v00, 1 -> v01, 100 -> v100) and guards against NULL values.
  v_code := COALESCE(NULLIF(TRIM(NEW.code), ''), 'S/C');
  v_title := COALESCE(NULLIF(TRIM(NEW.title), ''), 'Sin título');
  v_version := 'v' || CASE
    WHEN LENGTH(COALESCE(NEW.version, 0)::TEXT) < 2
      THEN LPAD(COALESCE(NEW.version, 0)::TEXT, 2, '0')
    ELSE COALESCE(NEW.version, 0)::TEXT
  END;
  v_doc_label := '[' || v_code || '] ' || v_title || ' (' || v_version || ')';

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
          'Nuevo borrador pendiente de revisión: ' || v_doc_label
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
          'Documento revisado pendiente de aprobación: ' || v_doc_label
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
          'Nuevo documento aprobado disponible: ' || v_doc_label
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
    'Automates notification dispatch with document code, title, and version on document workflow status transitions (REVIEW_REQUIRED, APPROVAL_REQUIRED, DOCUMENT_APPROVED).';

GRANT EXECUTE ON FUNCTION public.handle_document_status_change() TO authenticated, service_role;
