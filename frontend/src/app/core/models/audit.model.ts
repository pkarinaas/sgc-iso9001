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

/** Supported audit action identifiers recorded in public.audit_logs. */
export type AuditActionType =
  | 'DOCUMENT_CREATED'
  | 'VERSION_UPLOADED'
  | 'DOCUMENT_UPDATED'
  | 'STATUS_CHANGED'
  | 'DOCUMENT_APPROVED'
  | 'DOCUMENT_DELETED'
  | 'READ_ACKNOWLEDGED'
  | 'DRIVE_SYNC_SUCCESS'
  | 'DRIVE_SYNC_ERROR';

/** Structured metadata snapshot stored in `public.audit_logs.details`. */
export interface AuditLogDetails {
  document_code?: string | null;
  document_title?: string | null;
  document_version?: number | null;
  process_area?: string | null;
  old_status?: string | null;
  new_status?: string | null;
  old_code?: string | null;
  old_title?: string | null;
  old_process_area?: string | null;
  changed_fields?: string[] | null;
  deleted_document_id?: number | string | null;
  acknowledgement_id?: string | null;
  drive_file_id?: string | null;
  drive_synced_at?: string | null;
  drive_sync_error?: string | null;
}

/** Normalized chronological audit log entry enriched with user and document metadata. */
export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  document_id: number | string | null;
  action: AuditActionType | string;
  details: AuditLogDetails;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  doc_code: string | null;
  doc_title: string | null;
  doc_version: number | null;
}

/** Filter criteria supported by global audit log queries. */
export interface AuditLogFilterCriteria {
  userId?: string | null;
  documentQuery?: string | null;
  action?: AuditActionType | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}

