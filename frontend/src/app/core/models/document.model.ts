/**
 * Domain models for the Document Repository.
 * These interfaces mirror the public.documents table in Supabase.
 */

/** Allowed lifecycle states for a controlled document. */
export type DocumentStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'OBSOLETE';

/** Allowed Google Drive synchronization states for an approved document. */
export type DriveSyncStatus = 'PENDING' | 'SYNCED' | 'ERROR';

/** Subset of Google Drive backup tracking fields returned when polling sync status. */
export interface DriveSyncSnapshot {
  drive_sync_status: DriveSyncStatus | null;
  drive_file_id: string | null;
  drive_sync_error: string | null;
  drive_synced_at: string | null;
}

/** Represents a row in the public.documents table. */
export interface Document {
  id: string;
  /** Code assigned to the document (e.g. "SGC-PR-001"). */
  code: string;
  title: string;
  /** Document version number. */
  version: number;
  /** Current state in the approval lifecycle. */
  status: DocumentStatus;
  /** Process or operational area to which this document belongs. */
  process_area?: string | null;
  /** Supabase Storage URL for the uploaded file, or null if not yet uploaded. */
  file_url: string | null;
  /** UUID of the user who created this document. */
  creator_id: string;
  /** UUID of the user who last updated this document. */
  updater_id?: string | null;
  /** Google Drive backup synchronization state for approved documents. */
  drive_sync_status?: DriveSyncStatus | null;
  /** Google Drive file ID returned upon successful backup upload. */
  drive_file_id?: string | null;
  /** Concise error message captured if the last Google Drive sync failed. */
  drive_sync_error?: string | null;
  /** ISO timestamp when the document PDF was last successfully backed up to Drive. */
  drive_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Represents a row in the public.document_acknowledgements table. */
export interface DocumentAcknowledgement {
  id: string;
  document_id: string | number;
  user_id: string;
  acknowledged_at?: string;
  signature_hash?: string | null;
}
