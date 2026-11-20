-- Migration: Add Google Drive Sync Tracking Columns to Documents

-- 1. Add tracking columns to public.documents
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS drive_sync_status TEXT,
    ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
    ADD COLUMN IF NOT EXISTS drive_sync_error TEXT,
    ADD COLUMN IF NOT EXISTS drive_synced_at TIMESTAMPTZ;

-- 2. Enforce allowed values for drive_sync_status
ALTER TABLE public.documents
    DROP CONSTRAINT IF EXISTS check_documents_drive_sync_status;

ALTER TABLE public.documents
    ADD CONSTRAINT check_documents_drive_sync_status
    CHECK (drive_sync_status IS NULL OR drive_sync_status IN ('PENDING', 'SYNCED', 'ERROR'));

-- 3. Column documentation comments
COMMENT ON COLUMN public.documents.drive_sync_status IS
    'Google Drive backup synchronization state: NULL (not started), PENDING, SYNCED, or ERROR.';
COMMENT ON COLUMN public.documents.drive_file_id IS
    'Google Drive file ID returned upon successful PDF upload.';
COMMENT ON COLUMN public.documents.drive_sync_error IS
    'Concise error message recorded if the last Google Drive sync attempt failed.';
COMMENT ON COLUMN public.documents.drive_synced_at IS
    'Timestamp when the document PDF was last successfully synced to Google Drive.';

-- 4. Partial index for querying pending or failed Drive sync records
CREATE INDEX IF NOT EXISTS idx_documents_drive_sync_status
    ON public.documents (drive_sync_status)
    WHERE drive_sync_status IS NOT NULL;
