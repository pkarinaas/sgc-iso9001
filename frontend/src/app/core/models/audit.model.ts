/**
 * Domain models for ISO 9001 Audit Reports.
 * Mirrors the public.audit_acknowledgements_view PostgreSQL view in Supabase.
 */

export interface AuditRecord {
  /** Unique identifier of the acknowledgement record. */
  ack_id: string;
  /** Primary key identifier of the document. */
  document_id: number;
  /** Controlled document code (e.g., 'SGC-PR-001'). */
  doc_code: string;
  /** Full title of the document. */
  doc_title: string;
  /** Version number of the document at acknowledgement time. */
  doc_version: number;
  /** Operational/process area of the document (e.g., 'QUALITY', 'OPERATIONS'). */
  process_area: string | null;
  /** Lifecycle status of the document (e.g., 'APPROVED'). */
  doc_status?: string | null;
  /** UUID of the user who confirmed reading. */
  user_id: string;
  /** Full name of the user. */
  user_name: string;
  /** Email address of the user. */
  user_email?: string | null;
  /** Role of the user (e.g., 'ADMIN', 'EDITOR', 'VIEWER'). */
  user_role: string;
  /** Timestamp when reading acknowledgement was registered. */
  read_at: string;
  /** Cryptographic proof/signature hash validating the acknowledgement. */
  signature_hash?: string | null;
}

