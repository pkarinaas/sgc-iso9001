-- Migration: Add REVIEWED Status to Document Lifecycle

-- 1. Drop the existing CHECK constraint on status
ALTER TABLE public.documents
    DROP CONSTRAINT IF EXISTS check_document_status;

-- 2. Add updated CHECK constraint with 'REVIEWED' included
ALTER TABLE public.documents
    ADD CONSTRAINT check_document_status
    CHECK (status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'OBSOLETE'));
