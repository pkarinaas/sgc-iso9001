import { inject, Injectable } from '@angular/core';
import { supabase } from '../supabase/supabase.client';
import { DocumentService } from './document.service';
import type { Document } from '../models/document.model';
import type { DashboardMetrics } from '../models/dashboard.model';

/**
 * DashboardService provides data aggregation and analytics for the dashboard view.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly documentService = inject(DocumentService);

  /** Direct Supabase client instance reference for RPC and database queries. */
  readonly supabase = supabase;

  /**
   * Fetches aggregated metrics for the admin dashboard via the get_dashboard_metrics RPC.
   *
   * @returns Aggregated metrics payload containing documentsByStatus and totalAcknowledgements.
   * @throws Error if the RPC execution fails.
   */
  async getDashboardMetrics(): Promise<DashboardMetrics | any> {
    const { data, error } = await this.supabase.rpc('get_dashboard_metrics');

    if (error) {
      console.error('Error fetching dashboard metrics via RPC:', error);
      throw new Error(`Error al obtener métricas del dashboard: ${error.message}`);
    }

    return data;
  }

  /**
   * Retrieves all approved documents belonging to the user's assigned process areas
   * that have not yet been acknowledged by the user.
   *
   * @param userId - UUID of the user.
   * @param userAreas - Process area keys assigned to the user.
   * @returns Array of pending Document records.
   */
  async getPendingDocuments(userId: string, userAreas: string[]): Promise<Document[]> {
    return this.documentService.getPendingDocuments(userId, userAreas);
  }

  /**
   * Records a user's mandatory reading acknowledgement for a document.
   *
   * @param documentId - UUID or ID of the document.
   * @param userId - UUID of the user.
   * @returns Supabase response.
   */
  async acknowledgeDocument(documentId: string | number, userId: string): Promise<any> {
    return this.documentService.acknowledgeDocument(documentId, userId);
  }
}
