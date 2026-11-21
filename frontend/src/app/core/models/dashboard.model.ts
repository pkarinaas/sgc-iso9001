/**
 * Pending user obligations grouped by document.
 */
export interface PendingDocumentDetail {
  /** Title of the approved document requiring acknowledgement. */
  documentTitle: string;
  /** Process area key associated with the document. */
  processArea: string;
  /** Array of user full names with pending mandatory reads for this document. */
  pendingUsers: string[];

  // Snake_case aliases from Postgres RPC
  document_title?: string;
  process_area?: string;
  pending_users?: string[];
  documentId?: number | string;
  document_id?: number | string;
  code?: string;
}

/**
 * Dashboard metrics payload returned by the get_dashboard_metrics RPC.
 */
export interface DashboardMetrics {
  /** Count of documents grouped by their lifecycle status (e.g. DRAFT, REVIEWED, APPROVED). */
  documentsByStatus: Record<string, number>;
  /** Total count of completed mandatory reading acknowledgements. */
  totalCompleted: number;
  /** Total count of required reading obligations that have not yet been completed. */
  totalPending: number;
  /** Overall adherence rate as a percentage: (totalCompleted / (totalCompleted + totalPending)) * 100. */
  adherencePercentage: number;
  /** List of documents with pending reading obligations and user lists. */
  pendingDetails: PendingDocumentDetail[];

  /** Backwards compatibility alias for totalCompleted. */
  totalAcknowledgements?: number;

  /** Snake_case aliases matching Postgres RPC return structure. */
  documents_by_status?: Record<string, number>;
  total_completed?: number;
  total_pending?: number;
  adherence_percentage?: number;
  pending_details?: PendingDocumentDetail[];
  total_acknowledgements?: number;
}
