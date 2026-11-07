-- Migration: Update Document States and Partial Unique Index

-- 1. Update any existing NULL status values to 'DRAFT'
UPDATE public.documents
SET status = 'DRAFT'
WHERE status IS NULL;

-- 2. Enforce DEFAULT 'DRAFT' and NOT NULL on the status column
ALTER TABLE public.documents
    ALTER COLUMN status SET DEFAULT 'DRAFT',
    ALTER COLUMN status SET NOT NULL;

-- 3. Add CHECK constraint on status
ALTER TABLE public.documents
    DROP CONSTRAINT IF EXISTS check_document_status;

ALTER TABLE public.documents
    ADD CONSTRAINT check_document_status
    CHECK (status IN ('DRAFT', 'APPROVED', 'OBSOLETE'));

-- 4. Drop the global UNIQUE constraint on the code column
ALTER TABLE public.documents
    DROP CONSTRAINT IF EXISTS documents_code_key;

-- 5. Create a partial unique index enforcing uniqueness only among APPROVED documents
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_approved_code
    ON public.documents (code)
    WHERE status = 'APPROVED';

