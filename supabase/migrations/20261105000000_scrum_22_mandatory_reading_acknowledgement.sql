-- Migration: Mandatory Reading Acknowledgement & Process Area Mapping

-- 1. Add process_area to public.documents
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS process_area TEXT;

COMMENT ON COLUMN public.documents.process_area IS
    'Process or operational area to which this document belongs (e.g., QUALITY, OPERATIONS, HR).';

-- 2. Add assigned_processes to public.users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS assigned_processes TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.users.assigned_processes IS
    'List of process or area identifiers assigned to the user for document visibility and reading obligations.';

-- 3. Create document_acknowledgements table
CREATE TABLE IF NOT EXISTS public.document_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id INT NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_document_acknowledgements_doc_user UNIQUE (document_id, user_id)
);

COMMENT ON TABLE public.document_acknowledgements IS
    'Immutable audit trail recording mandatory reading acknowledgements of controlled documents by users.';

-- Indexes for performance on lookups and join queries
CREATE INDEX IF NOT EXISTS idx_doc_ack_user_id
    ON public.document_acknowledgements (user_id);

CREATE INDEX IF NOT EXISTS idx_doc_ack_document_id
    ON public.document_acknowledgements (document_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.document_acknowledgements ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Authenticated users can view their own acknowledgements.
-- ADMIN users can view all acknowledgements across the organization.
DROP POLICY IF EXISTS "document_acknowledgements_select_policy" ON public.document_acknowledgements;
CREATE POLICY "document_acknowledgements_select_policy"
ON public.document_acknowledgements
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.is_admin()
);
-- Authenticated users can only record their own reading acknowledgements.
DROP POLICY IF EXISTS "document_acknowledgements_insert_policy" ON public.document_acknowledgements;
CREATE POLICY "document_acknowledgements_insert_policy"
ON public.document_acknowledgements
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
);

-- 6. Immutability Enforcement
-- Explicitly revoke UPDATE and DELETE privileges at the role level
REVOKE UPDATE, DELETE ON public.document_acknowledgements FROM authenticated, anon, public;
-- Defense-in-depth trigger to prevent any update or deletion attempt
CREATE OR REPLACE FUNCTION public.prevent_document_acknowledgements_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ISO 9001 Audit Violation: Records in document_acknowledgements are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_prevent_doc_ack_mutation ON public.document_acknowledgements;
CREATE TRIGGER tr_prevent_doc_ack_mutation
BEFORE UPDATE OR DELETE ON public.document_acknowledgements
FOR EACH ROW
EXECUTE FUNCTION public.prevent_document_acknowledgements_mutation();
