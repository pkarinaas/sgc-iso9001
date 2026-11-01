/**
 * Domain models for the Document Repository.
 * These interfaces mirror the public.documents table in Supabase.
 */

/** Allowed lifecycle states for a controlled document. */
export type DocumentStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'OBSOLETE';

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
  /** Supabase Storage URL for the uploaded file, or null if not yet uploaded. */
  file_url: string | null;
  /** UUID of the user who created this document. */
  creator_id: string;
  /** UUID of the user who last updated this document. */
  updater_id?: string | null;
  created_at: string;
  updated_at: string;
}
