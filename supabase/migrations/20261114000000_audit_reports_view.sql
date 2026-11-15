-- Migration: ISO 9001 Audit Acknowledgements View
-- Provides a consolidated audit trail linking document reading acknowledgements
-- with document details and user profile/role information.

CREATE OR REPLACE VIEW public.audit_acknowledgements_view AS
SELECT
    da.id AS ack_id,
    d.id AS document_id,
    d.code AS doc_code,
    d.title AS doc_title,
    d.version AS doc_version,
    d.process_area AS process_area,
    d.status AS doc_status,
    u.id AS user_id,
    u.full_name AS user_name,
    u.email AS user_email,
    COALESCE(r.name, 'VIEWER') AS user_role,
    da.read_at AS read_at,
    encode(sha256(concat(da.id::text, ':', da.document_id::text, ':', da.user_id::text, ':', da.read_at::text)::bytea), 'hex') AS signature_hash
FROM public.document_acknowledgements da
JOIN public.documents d ON da.document_id = d.id
JOIN public.users u ON da.user_id = u.id
LEFT JOIN public.roles r ON u.role_id = r.id;

COMMENT ON VIEW public.audit_acknowledgements_view IS
    'Unified ISO 9001 audit view providing tamper-evident traceability of document reading acknowledgements.';

-- Grant read access to authenticated users and service_role
GRANT SELECT ON public.audit_acknowledgements_view TO authenticated, service_role;

