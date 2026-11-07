import { inject, Injectable } from '@angular/core';
import { DocumentService } from './document.service';
import type { Document } from '../models/document.model';

/**
 * DashboardService provides data aggregation for the user's dashboard view.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly documentService = inject(DocumentService);

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

