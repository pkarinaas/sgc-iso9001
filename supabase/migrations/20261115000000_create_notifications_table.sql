-- Migration: Create Notifications Table for Real-Time In-App Alerts

-- 1. Create Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- Note: document_id is typed as INT to match public.documents(id) (SERIAL PRIMARY KEY).
    -- In PostgreSQL, foreign keys require matching types between referencing and referenced columns.
    document_id INT REFERENCES public.documents(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comments for database documentation
COMMENT ON TABLE public.notifications IS
    'Stores user notifications and alerts for ISO 9001 quality workflows (reviews, approvals, read confirmations).';
COMMENT ON COLUMN public.notifications.id IS 'Unique identifier for each notification record.';
COMMENT ON COLUMN public.notifications.user_id IS 'Recipient user ID referencing public.users(id).';
COMMENT ON COLUMN public.notifications.document_id IS 'Optional reference to the associated document in public.documents(id).';
COMMENT ON COLUMN public.notifications.type IS 'Notification classification (e.g., REVIEW_REQUIRED, DOCUMENT_APPROVED, READ_RECEIPT_REQUIRED).';
COMMENT ON COLUMN public.notifications.message IS 'Human-readable notification text.';
COMMENT ON COLUMN public.notifications.is_read IS 'Status flag indicating if the notification was acknowledged/read by the user.';
COMMENT ON COLUMN public.notifications.created_at IS 'Timestamp when the notification was generated.';

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON public.notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications (user_id, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_document_id
    ON public.notifications (document_id);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON public.notifications (created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- SELECT: Authenticated users can only read their own notifications
DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
CREATE POLICY "notifications_select_policy"
ON public.notifications
FOR SELECT
TO authenticated
USING (
    auth.uid() = user_id
);

-- UPDATE: Authenticated users can only update their own notifications (e.g., marking is_read as true)
DROP POLICY IF EXISTS "notifications_update_policy" ON public.notifications;
CREATE POLICY "notifications_update_policy"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
    auth.uid() = user_id
)
WITH CHECK (
    auth.uid() = user_id
);

-- 5. Role Grants
-- Authenticated users have SELECT and UPDATE privileges
GRANT SELECT, UPDATE ON public.notifications TO authenticated;

-- Service role retains full administrative privileges for automated background jobs and edge functions
GRANT ALL ON public.notifications TO service_role;

-- 6. Supabase Realtime Configuration
-- Set replica identity to FULL to send complete row data upon update/delete in Realtime broadcasts
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- Add notifications table to supabase_realtime publication if the publication exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'notifications'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
        END IF;
    END IF;
END $$;
