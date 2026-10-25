/**
 * Domain models for the Document Repository.
 * These interfaces mirror the public.documents table in Supabase.
 */

/** Allowed lifecycle states for a controlled document. */
export type DocumentStatus = 'DRAFT' | 'APPROVED' | 'OBSOLETE';

/** Represents a row in the public.documents table. */
export interface Document {
  id: string;
  /** Code assigned to the document (e.g. "SGC-PR-001"). */
  code: string;
  title: string;
  version: number;
  status: DocumentStatus;
  /** Supabase Storage URL for the uploaded file, or null if not yet uploaded. */
  file_url: string | null;
  /** UUID of the user who created this document. */
  creator_id: string;
  created_at: string;
  updated_at: string;
}
