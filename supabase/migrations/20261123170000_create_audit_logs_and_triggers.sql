-- Migration: ISO 9001 Audit Logs Table, Triggers, RLS Policies, and Historical Backfill
-- Provides an immutable, read-only chronological audit trail capturing:
--   - Document creation and new version uploads
--   - Document metadata edits
--   - Document lifecycle status transitions and approvals
--   - Document deletions (preserving snapshot details)
--   - Mandatory reading acknowledgements
--   - Google Drive backup synchronization successes and failures

-- 1. Create public.audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    document_id INT REFERENCES public.documents(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_audit_logs_action CHECK (
        action IN (
            'DOCUMENT_CREATED',
            'VERSION_UPLOADED',
            'DOCUMENT_UPDATED',
            'STATUS_CHANGED',
            'DOCUMENT_APPROVED',
            'DOCUMENT_DELETED',
            'READ_ACKNOWLEDGED',
            'DRIVE_SYNC_SUCCESS',
            'DRIVE_SYNC_ERROR'
        )
    )
);

COMMENT ON TABLE public.audit_logs IS
    'Immutable ISO 9001 audit trail recording document lifecycle, reading acknowledgement, and backup events.';

COMMENT ON COLUMN public.audit_logs.user_id IS
    'UUID of the acting user, or NULL for automated system background processes.';

COMMENT ON COLUMN public.audit_logs.document_id IS
    'Reference to public.documents(id), set to NULL if a draft/reviewed document is deleted.';

COMMENT ON COLUMN public.audit_logs.action IS
    'Categorized event identifier (DOCUMENT_CREATED, VERSION_UPLOADED, DOCUMENT_UPDATED, STATUS_CHANGED, DOCUMENT_APPROVED, DOCUMENT_DELETED, READ_ACKNOWLEDGED, DRIVE_SYNC_SUCCESS, DRIVE_SYNC_ERROR).';

COMMENT ON COLUMN public.audit_logs.details IS
    'Structured JSONB metadata snapshot describing the event context and transitions.';

-- 2. Performance indexes for per-document timelines and global filtered audit queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_document_created
    ON public.audit_logs (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
    ON public.audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
    ON public.audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON public.audit_logs (created_at DESC);

-- 3. Enforce Read-Only RLS and Immutability
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon, public;
GRANT SELECT ON public.audit_logs TO authenticated, service_role;
GRANT INSERT ON public.audit_logs TO service_role;

DROP POLICY IF EXISTS "audit_logs_select_policy" ON public.audit_logs;
CREATE POLICY "audit_logs_select_policy"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    public.get_current_user_role() IN ('ADMIN', 'APPROVER')
);

CREATE OR REPLACE FUNCTION public.prevent_audit_logs_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ISO 9001 Audit Violation: Records in audit_logs are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_prevent_audit_logs_mutation ON public.audit_logs;
CREATE TRIGGER tr_prevent_audit_logs_mutation
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_logs_mutation();

-- 4. Audit Trigger Function for public.documents
CREATE OR REPLACE FUNCTION public.log_document_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_action TEXT;
    v_changed_fields TEXT[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_actor_id := COALESCE(auth.uid(), NEW.creator_id);
        v_action := CASE
            WHEN COALESCE(NEW.version, 0) > 0 THEN 'VERSION_UPLOADED'
            ELSE 'DOCUMENT_CREATED'
        END;

        INSERT INTO public.audit_logs (user_id, document_id, action, details)
        VALUES (
            v_actor_id,
            NEW.id,
            v_action,
            jsonb_build_object(
                'document_code', NEW.code,
                'document_title', NEW.title,
                'document_version', NEW.version,
                'process_area', NEW.process_area,
                'new_status', NEW.status
            )
        );
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        v_actor_id := COALESCE(auth.uid(), NEW.updater_id, NEW.creator_id);

        -- Status transition event (including approvals and auto-obsolescence)
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            v_action := CASE
                WHEN NEW.status = 'APPROVED' THEN 'DOCUMENT_APPROVED'
                ELSE 'STATUS_CHANGED'
            END;

            INSERT INTO public.audit_logs (user_id, document_id, action, details)
            VALUES (
                v_actor_id,
                NEW.id,
                v_action,
                jsonb_build_object(
                    'document_code', NEW.code,
                    'document_title', NEW.title,
                    'document_version', NEW.version,
                    'process_area', NEW.process_area,
                    'old_status', OLD.status,
                    'new_status', NEW.status
                )
            );
        END IF;

        -- Document metadata update event
        IF NEW.title IS DISTINCT FROM OLD.title
           OR NEW.code IS DISTINCT FROM OLD.code
           OR NEW.process_area IS DISTINCT FROM OLD.process_area THEN
            v_changed_fields := ARRAY[]::TEXT[];
            IF NEW.title IS DISTINCT FROM OLD.title THEN
                v_changed_fields := array_append(v_changed_fields, 'title');
            END IF;
            IF NEW.code IS DISTINCT FROM OLD.code THEN
                v_changed_fields := array_append(v_changed_fields, 'code');
            END IF;
            IF NEW.process_area IS DISTINCT FROM OLD.process_area THEN
                v_changed_fields := array_append(v_changed_fields, 'process_area');
            END IF;

            INSERT INTO public.audit_logs (user_id, document_id, action, details)
            VALUES (
                v_actor_id,
                NEW.id,
                'DOCUMENT_UPDATED',
                jsonb_build_object(
                    'document_code', NEW.code,
                    'document_title', NEW.title,
                    'document_version', NEW.version,
                    'process_area', NEW.process_area,
                    'old_code', OLD.code,
                    'old_title', OLD.title,
                    'old_process_area', OLD.process_area,
                    'changed_fields', to_jsonb(v_changed_fields)
                )
            );
        END IF;

        -- Google Drive backup completion or failure event
        IF NEW.drive_sync_status IS DISTINCT FROM OLD.drive_sync_status THEN
            IF NEW.drive_sync_status = 'SYNCED' THEN
                INSERT INTO public.audit_logs (user_id, document_id, action, details)
                VALUES (
                    auth.uid(),
                    NEW.id,
                    'DRIVE_SYNC_SUCCESS',
                    jsonb_build_object(
                        'document_code', NEW.code,
                        'document_title', NEW.title,
                        'document_version', NEW.version,
                        'drive_file_id', NEW.drive_file_id,
                        'drive_synced_at', NEW.drive_synced_at
                    )
                );
            ELSIF NEW.drive_sync_status = 'ERROR' THEN
                INSERT INTO public.audit_logs (user_id, document_id, action, details)
                VALUES (
                    auth.uid(),
                    NEW.id,
                    'DRIVE_SYNC_ERROR',
                    jsonb_build_object(
                        'document_code', NEW.code,
                        'document_title', NEW.title,
                        'document_version', NEW.version,
                        'drive_sync_error', NEW.drive_sync_error
                    )
                );
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_actor_id := COALESCE(auth.uid(), OLD.updater_id, OLD.creator_id);

        INSERT INTO public.audit_logs (user_id, document_id, action, details)
        VALUES (
            v_actor_id,
            NULL,
            'DOCUMENT_DELETED',
            jsonb_build_object(
                'deleted_document_id', OLD.id,
                'document_code', OLD.code,
                'document_title', OLD.title,
                'document_version', OLD.version,
                'process_area', OLD.process_area,
                'old_status', OLD.status
            )
        );
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_documents_audit_log ON public.documents;
CREATE TRIGGER tr_documents_audit_log
AFTER INSERT OR UPDATE OR DELETE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.log_document_audit_event();

-- 5. Audit Trigger Function for public.document_acknowledgements
CREATE OR REPLACE FUNCTION public.log_acknowledgement_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_doc RECORD;
BEGIN
    SELECT d.code, d.title, d.version, d.process_area
    INTO v_doc
    FROM public.documents d
    WHERE d.id = NEW.document_id;

    INSERT INTO public.audit_logs (user_id, document_id, action, details, created_at)
    VALUES (
        COALESCE(NEW.user_id, auth.uid()),
        NEW.document_id,
        'READ_ACKNOWLEDGED',
        jsonb_build_object(
            'acknowledgement_id', NEW.id,
            'document_code', v_doc.code,
            'document_title', v_doc.title,
            'document_version', v_doc.version,
            'process_area', v_doc.process_area
        ),
        COALESCE(NEW.read_at, NOW())
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_document_acknowledgements_audit_log ON public.document_acknowledgements;
CREATE TRIGGER tr_document_acknowledgements_audit_log
AFTER INSERT ON public.document_acknowledgements
FOR EACH ROW
EXECUTE FUNCTION public.log_acknowledgement_audit_event();

-- 6. Idempotent Historical Backfill (runs only when audit_logs is empty)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.audit_logs) THEN
        -- Backfill document creation / initial version events
        INSERT INTO public.audit_logs (user_id, document_id, action, details, created_at)
        SELECT
            d.creator_id,
            d.id,
            CASE
                WHEN COALESCE(d.version, 0) > 0 THEN 'VERSION_UPLOADED'
                ELSE 'DOCUMENT_CREATED'
            END,
            jsonb_build_object(
                'document_code', d.code,
                'document_title', d.title,
                'document_version', d.version,
                'process_area', d.process_area,
                'new_status', d.status
            ),
            d.created_at
        FROM public.documents d;

        -- Backfill approval events for existing APPROVED documents
        INSERT INTO public.audit_logs (user_id, document_id, action, details, created_at)
        SELECT
            COALESCE(d.updater_id, d.creator_id),
            d.id,
            'DOCUMENT_APPROVED',
            jsonb_build_object(
                'document_code', d.code,
                'document_title', d.title,
                'document_version', d.version,
                'process_area', d.process_area,
                'new_status', 'APPROVED'
            ),
            CASE
                WHEN d.updated_at > d.created_at THEN d.updated_at
                ELSE d.created_at + INTERVAL '1 millisecond'
            END
        FROM public.documents d
        WHERE d.status = 'APPROVED';

        -- Backfill existing Google Drive sync outcomes
        INSERT INTO public.audit_logs (user_id, document_id, action, details, created_at)
        SELECT
            NULL,
            d.id,
            CASE
                WHEN d.drive_sync_status = 'SYNCED' THEN 'DRIVE_SYNC_SUCCESS'
                ELSE 'DRIVE_SYNC_ERROR'
            END,
            CASE
                WHEN d.drive_sync_status = 'SYNCED' THEN
                    jsonb_build_object(
                        'document_code', d.code,
                        'document_title', d.title,
                        'document_version', d.version,
                        'drive_file_id', d.drive_file_id,
                        'drive_synced_at', d.drive_synced_at
                    )
                ELSE
                    jsonb_build_object(
                        'document_code', d.code,
                        'document_title', d.title,
                        'document_version', d.version,
                        'drive_sync_error', d.drive_sync_error
                    )
            END,
            COALESCE(d.drive_synced_at, d.updated_at, d.created_at) + INTERVAL '2 milliseconds'
        FROM public.documents d
        WHERE d.drive_sync_status IN ('SYNCED', 'ERROR');

        -- Backfill mandatory reading acknowledgements
        INSERT INTO public.audit_logs (user_id, document_id, action, details, created_at)
        SELECT
            da.user_id,
            da.document_id,
            'READ_ACKNOWLEDGED',
            jsonb_build_object(
                'acknowledgement_id', da.id,
                'document_code', d.code,
                'document_title', d.title,
                'document_version', d.version,
                'process_area', d.process_area
            ),
            da.read_at
        FROM public.document_acknowledgements da
        JOIN public.documents d ON d.id = da.document_id;
    END IF;
END;
$$;
