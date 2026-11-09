/**
 * Dashboard metrics payload returned by the get_dashboard_metrics RPC.
 */
export interface DashboardMetrics {
  /** Count of documents grouped by their lifecycle status (e.g. DRAFT, REVIEWED, APPROVED). */
  documentsByStatus: Record<string, number>;
  /** Total count of mandatory reading acknowledgements. */
  totalAcknowledgements: number;
  /** Snake_case alias for document status counts. */
  documents_by_status?: Record<string, number>;
  /** Snake_case alias for total acknowledgements count. */
  total_acknowledgements?: number;
}

