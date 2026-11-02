-- Migration: Auto-Obsolescence Trigger for Approved Documents
-- When a document status transitions to 'APPROVED', any existing 'APPROVED' document
-- with the same code is automatically updated to 'OBSOLETE' BEFORE the update occurs.
-- This ensures strict compliance with ISO 9001 single-active-version traceability and
-- prevents violation of the partial unique index idx_documents_approved_code.

CREATE OR REPLACE FUNCTION public.handle_auto_obsolete_documents()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if document is transitioning to 'APPROVED' from another status
  IF NEW.status = 'APPROVED' AND (OLD.status IS NULL OR OLD.status != 'APPROVED') THEN
    IF NEW.code IS NOT NULL AND TRIM(NEW.code) != '' THEN
      UPDATE public.documents
      SET status = 'OBSOLETE',
          updated_at = NOW()
      WHERE code = NEW.code
        AND status = 'APPROVED'
        AND id != NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.handle_auto_obsolete_documents() TO authenticated;

-- Create BEFORE UPDATE trigger on public.documents
DROP TRIGGER IF EXISTS tr_documents_auto_obsolete ON public.documents;
CREATE TRIGGER tr_documents_auto_obsolete
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.handle_auto_obsolete_documents();
