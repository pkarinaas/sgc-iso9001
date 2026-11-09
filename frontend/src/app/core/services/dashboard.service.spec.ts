import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardService } from './dashboard.service';
import { DocumentService } from './document.service';
import type { DashboardMetrics } from '../models/dashboard.model';

describe('DashboardService', () => {
  let service: DashboardService;
  let mockDocumentService: {
    getPendingDocuments: ReturnType<typeof vi.fn>;
    acknowledgeDocument: ReturnType<typeof vi.fn>;
  };

  const mockMetrics: DashboardMetrics = {
    documentsByStatus: {
      DRAFT: 3,
      REVIEWED: 2,
      APPROVED: 8,
      OBSOLETE: 1,
    },
    totalAcknowledgements: 42,
    documents_by_status: {
      DRAFT: 3,
      REVIEWED: 2,
      APPROVED: 8,
      OBSOLETE: 1,
    },
    total_acknowledgements: 42,
  };

  beforeEach(() => {
    mockDocumentService = {
      getPendingDocuments: vi.fn().mockResolvedValue([]),
      acknowledgeDocument: vi.fn().mockResolvedValue({ id: 'ack-1' }),
    };

    TestBed.configureTestingModule({
      providers: [DashboardService, { provide: DocumentService, useValue: mockDocumentService }],
    });

    service = TestBed.inject(DashboardService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
    expect(service.supabase).toBeDefined();
  });

  describe('getDashboardMetrics RPC', () => {
    it('should call supabase.rpc("get_dashboard_metrics") and return metrics data', async () => {
      const rpcSpy = vi.spyOn(service.supabase, 'rpc').mockResolvedValueOnce({
        data: mockMetrics,
        error: null,
      } as any);

      const result = await service.getDashboardMetrics();

      expect(rpcSpy).toHaveBeenCalledWith('get_dashboard_metrics');
      expect(result).toEqual(mockMetrics);
      expect(result.documentsByStatus).toBeDefined();
      expect(result.totalAcknowledgements).toBe(42);
    });

    it('should throw an error when supabase.rpc returns an error object', async () => {
      vi.spyOn(service.supabase, 'rpc').mockResolvedValueOnce({
        data: null,
        error: { message: 'function get_dashboard_metrics() does not exist' },
      } as any);

      await expect(service.getDashboardMetrics()).rejects.toThrow(
        'Error al obtener métricas del dashboard: function get_dashboard_metrics() does not exist',
      );
    });
  });

  describe('Delegated document methods', () => {
    it('should delegate getPendingDocuments to DocumentService', async () => {
      const pendingDocs = [{ id: 'doc-1', title: 'Test Document' }] as any;
      mockDocumentService.getPendingDocuments.mockResolvedValueOnce(pendingDocs);

      const result = await service.getPendingDocuments('usr-1', ['quality', 'operations']);

      expect(mockDocumentService.getPendingDocuments).toHaveBeenCalledWith('usr-1', [
        'quality',
        'operations',
      ]);
      expect(result).toEqual(pendingDocs);
    });

    it('should delegate acknowledgeDocument to DocumentService', async () => {
      const ackResult = { id: 'ack-99', document_id: 'doc-1', user_id: 'usr-1' };
      mockDocumentService.acknowledgeDocument.mockResolvedValueOnce(ackResult);

      const result = await service.acknowledgeDocument('doc-1', 'usr-1');

      expect(mockDocumentService.acknowledgeDocument).toHaveBeenCalledWith('doc-1', 'usr-1');
      expect(result).toEqual(ackResult);
    });
  });
});
