-- Migration: Update Dashboard Analytics Metrics RPC

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    status_counts json;
    completed_count bigint;
    pending_count bigint;
    adherence_pct numeric;
    pending_details_json json;
BEGIN
    -- 1. Document counts grouped by status
    SELECT json_object_agg(status, count)
    INTO status_counts
    FROM (
        SELECT status, count(*) AS count
        FROM public.documents
        GROUP BY status
    ) sub;

    -- 2. Total completed reading acknowledgements
    SELECT count(*)
    INTO completed_count
    FROM public.document_acknowledgements;

    -- 3. Calculate pending reads and group pending users by document
    WITH required_reads AS (
        SELECT
            d.id AS document_id,
            d.code AS document_code,
            d.title AS document_title,
            d.process_area,
            u.id AS user_id,
            u.full_name AS user_name
        FROM public.documents d
        CROSS JOIN public.users u
        WHERE d.status = 'APPROVED'
          AND d.process_area IS NOT NULL
          AND d.process_area <> ''
          AND d.process_area = ANY(u.assigned_processes)
          AND (u.is_active IS TRUE OR u.is_active IS NULL)
    ),
    pending_reads AS (
        SELECT
            rr.document_id,
            rr.document_code,
            rr.document_title,
            rr.process_area,
            rr.user_id,
            rr.user_name
        FROM required_reads rr
        LEFT JOIN public.document_acknowledgements da
            ON da.document_id = rr.document_id
           AND da.user_id = rr.user_id
        WHERE da.id IS NULL
    ),
    doc_grouped AS (
        SELECT
            pr.document_id,
            pr.document_code,
            pr.document_title,
            pr.process_area,
            json_agg(pr.user_name ORDER BY pr.user_name) AS pending_users,
            count(*) AS doc_pending_count
        FROM pending_reads pr
        GROUP BY pr.document_id, pr.document_code, pr.document_title, pr.process_area
        ORDER BY pr.document_title
    )
    SELECT
        COALESCE(SUM(doc_pending_count), 0),
        COALESCE(
            json_agg(
                json_build_object(
                    'documentTitle', doc_grouped.document_title,
                    'document_title', doc_grouped.document_title,
                    'processArea', doc_grouped.process_area,
                    'process_area', doc_grouped.process_area,
                    'pendingUsers', doc_grouped.pending_users,
                    'pending_users', doc_grouped.pending_users,
                    'documentId', doc_grouped.document_id,
                    'document_id', doc_grouped.document_id,
                    'code', doc_grouped.document_code
                )
            ),
            '[]'::json
        )
    INTO pending_count, pending_details_json
    FROM doc_grouped;

    -- Ensure non-null count for pending reads
    pending_count := COALESCE(pending_count, 0);

    -- 4. Calculate adherence percentage: (total_completed / (total_completed + total_pending)) * 100
    IF (completed_count + pending_count) = 0 THEN
        adherence_pct := 100.0;
    ELSE
        adherence_pct := ROUND(((completed_count::numeric / (completed_count + pending_count)::numeric) * 100.0), 2);
    END IF;

    -- 5. Return structured JSON payload supporting camelCase and snake_case properties
    RETURN json_build_object(
        'documentsByStatus', COALESCE(status_counts, '{}'::json),
        'documents_by_status', COALESCE(status_counts, '{}'::json),
        'totalCompleted', completed_count,
        'total_completed', completed_count,
        'totalPending', pending_count,
        'total_pending', pending_count,
        'adherencePercentage', adherence_pct,
        'adherence_percentage', adherence_pct,
        'pendingDetails', COALESCE(pending_details_json, '[]'::json),
        'pending_details', COALESCE(pending_details_json, '[]'::json),
        'totalAcknowledgements', completed_count,
        'total_acknowledgements', completed_count
    );
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_metrics() IS
    'Returns refined dashboard analytics: document counts by status, completed reads, pending reads, adherence percentage, and pending users grouped by document.';

-- Grant execution permissions
REVOKE ALL ON FUNCTION public.get_dashboard_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics() TO authenticated, service_role;

