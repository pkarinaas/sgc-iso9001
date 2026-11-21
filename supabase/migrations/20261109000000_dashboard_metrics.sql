-- Migration: Dashboard Analytics Metrics RPC

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    status_counts json;
    ack_count bigint;
BEGIN
    -- 1. Aggregate document counts grouped by their lifecycle status
    SELECT json_object_agg(status, count)
    INTO status_counts
    FROM (
        SELECT status, count(*) AS count
        FROM public.documents
        GROUP BY status
    ) sub;

    -- 2. Count total reading acknowledgements recorded in the system
    SELECT count(*)
    INTO ack_count
    FROM public.document_acknowledgements;

    -- 3. Return JSON payload supporting both camelCase and snake_case properties
    RETURN json_build_object(
        'documentsByStatus', COALESCE(status_counts, '{}'::json),
        'documents_by_status', COALESCE(status_counts, '{}'::json),
        'totalAcknowledgements', ack_count,
        'total_acknowledgements', ack_count
    );
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_metrics() IS
    'Returns aggregated metrics for the dashboard: document counts grouped by status and total reading acknowledgements.';

-- Execution permissions: accessible to authenticated users and service_role
REVOKE ALL ON FUNCTION public.get_dashboard_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics() TO authenticated, service_role;

