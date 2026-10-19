-- SGC ISO 9001 - AUDIT TRIGGERS MIGRATION

-- 1. Add audit columns to the users table
ALTER TABLE public.users
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updater_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Create a shared function to record the timestamp and authenticated user
-- SECURITY DEFINER allows the function to execute with its owner's privileges.
CREATE OR REPLACE FUNCTION public.iso_audit_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.updater_id = auth.uid();
    RETURN NEW;
END;
$$;

-- 3. Apply audit tracking to updates on the users table
DROP TRIGGER IF EXISTS tr_users_audit ON public.users;
CREATE TRIGGER tr_users_audit
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.iso_audit_update();

-- 4. Replace the legacy timestamp trigger with audit tracking on documents
DROP TRIGGER IF EXISTS set_timestamp ON public.documents;
CREATE TRIGGER tr_documents_audit
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.iso_audit_update();
