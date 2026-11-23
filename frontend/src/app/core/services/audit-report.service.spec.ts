import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditReportService } from './audit-report.service';
import type { AuditRecord } from '../models/audit.model';

describe('AuditReportService', () => {
  let service: AuditReportService;

  const mockAuditRecords: AuditRecord[] = [
    {
      ack_id: 'ack-001',
      document_id: 1,
      doc_code: 'SGC-PR-001',
      doc_title: 'Procedimiento de Control Documental',
      doc_version: 1,
      process_area: 'calidad',
      doc_status: 'APPROVED',
      user_id: 'usr-101',
      user_name: 'Carlos Gómez',
      user_email: 'carlos.gomez@empresa.com',
      user_role: 'ADMIN',
      read_at: '2026-11-10T14:30:00Z',
      signature_hash: 'a1b2c3d4e5f6',
    },
    {
      ack_id: 'ack-002',
      document_id: 2,
      doc_code: 'SGC-IT-002',
      doc_title: 'Instructivo de Calibración',
      doc_version: 2,
      process_area: 'operaciones',
      doc_status: 'APPROVED',
      user_id: 'usr-102',
      user_name: 'María López',
      user_email: 'maria.lopez@empresa.com',
      user_role: 'VIEWER',
      read_at: '2026-11-09T09:15:00Z',
      signature_hash: 'f6e5d4c3b2a1',
    },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuditReportService],
    });

    service = TestBed.inject(AuditReportService);
  });

  it('should be created with initial signal states', () => {
    expect(service).toBeTruthy();
    expect(service.supabase).toBeDefined();
    expect(service.records()).toEqual([]);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  describe('getAuditRecords', () => {
    it('should query audit_acknowledgements_view, populate records signal, and return records array', async () => {
      const orderMock = vi.fn().mockResolvedValueOnce({
        data: mockAuditRecords,
        error: null,
      });
      const selectMock = vi.fn().mockReturnValue({
        order: orderMock,
      });
      const fromSpy = vi.spyOn(service.supabase, 'from').mockReturnValue({
        select: selectMock,
      } as unknown as ReturnType<typeof service.supabase.from>);

      const promise = service.getAuditRecords();
      expect(service.loading()).toBe(true);

      const result = await promise;

      expect(fromSpy).toHaveBeenCalledWith('audit_acknowledgements_view');
      expect(selectMock).toHaveBeenCalledWith('*');
      expect(orderMock).toHaveBeenCalledWith('read_at', { ascending: false });

      expect(result).toEqual(mockAuditRecords);
      expect(service.records()).toEqual(mockAuditRecords);
      expect(service.loading()).toBe(false);
      expect(service.error()).toBeNull();
    });

    it('should handle null data gracefully by setting empty records array', async () => {
      vi.spyOn(service.supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValueOnce({
            data: null,
            error: null,
          }),
        }),
      } as unknown as ReturnType<typeof service.supabase.from>);

      const result = await service.getAuditRecords();

      expect(result).toEqual([]);
      expect(service.records()).toEqual([]);
      expect(service.loading()).toBe(false);
      expect(service.error()).toBeNull();
    });

    it('should set error signal, reset loading, and throw Error when supabase returns an error object', async () => {
      vi.spyOn(service.supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValueOnce({
            data: null,
            error: { message: 'permission denied for view audit_acknowledgements_view' },
          }),
        }),
      } as unknown as ReturnType<typeof service.supabase.from>);

      await expect(service.getAuditRecords()).rejects.toThrow(
        'Error al obtener registros de auditoría: permission denied for view audit_acknowledgements_view',
      );

      expect(service.loading()).toBe(false);
      expect(service.error()).toBe(
        'Error al obtener registros de auditoría: permission denied for view audit_acknowledgements_view',
      );
    });

    it('should set error signal and rethrow when an unexpected exception is thrown', async () => {
      vi.spyOn(service.supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockRejectedValueOnce(new Error('Network failure')),
        }),
      } as unknown as ReturnType<typeof service.supabase.from>);

      await expect(service.getAuditRecords()).rejects.toThrow('Network failure');

      expect(service.loading()).toBe(false);
      expect(service.error()).toBe('Network failure');
    });
  });

  describe('getDocumentHistory', () => {
    it('should query audit_logs for documentId ordered newest first and normalize object and array relations', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const rawRows = [
        {
          id: 'log-2',
          user_id: 'usr-2',
          document_id: 15,
          action: 'DOCUMENT_APPROVED',
          details: { old_status: 'REVIEWED', new_status: 'APPROVED' },
          created_at: '2026-11-20T14:00:00Z',
          users: [{ full_name: 'Ana Gómez', email: 'ana@empresa.com' }],
          documents: [{ code: 'POE-015', title: 'Control Interno', version: 2 }],
        },
        {
          id: 'log-1',
          user_id: null,
          document_id: 15,
          action: 'DRIVE_SYNC_SUCCESS',
          details: { document_code: 'POE-015', document_title: 'Control Interno', document_version: 2 },
          created_at: '2026-11-20T14:05:00Z',
          users: null,
          documents: null,
        },
      ];

      const orderMock = vi.fn().mockResolvedValueOnce({ data: rawRows, error: null });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      const fromSpy = vi.spyOn(service.supabase, 'from').mockReturnValueOnce({
        select: selectMock,
      } as unknown as ReturnType<typeof service.supabase.from>);

      const history = await service.getDocumentHistory(15);

      expect(fromSpy).toHaveBeenCalledWith('audit_logs');
      expect(eqMock).toHaveBeenCalledWith('document_id', 15);
      expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(
        expect.objectContaining({
          id: 'log-2',
          user_name: 'Ana Gómez',
          user_email: 'ana@empresa.com',
          doc_code: 'POE-015',
          doc_title: 'Control Interno',
          doc_version: 2,
        }),
      );
      expect(history[1]).toEqual(
        expect.objectContaining({
          id: 'log-1',
          user_name: null,
          doc_code: 'POE-015',
          doc_title: 'Control Interno',
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it('should throw Spanish error when getDocumentHistory fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const orderMock = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: 'permission denied for table audit_logs' },
      });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      vi.spyOn(service.supabase, 'from').mockReturnValueOnce({
        select: selectMock,
      } as unknown as ReturnType<typeof service.supabase.from>);

      await expect(service.getDocumentHistory(15)).rejects.toThrow(
        'Error al obtener historial de trazabilidad: permission denied for table audit_logs',
      );
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('getAuditLogs (SCRUM-104)', () => {
    it('should query audit_logs with filters, update signals, and filter by document query', async () => {
      const rawRows = [
        {
          id: 'log-a',
          user_id: 'usr-1',
          document_id: 1,
          action: 'DOCUMENT_APPROVED',
          details: { old_status: 'REVIEWED', new_status: 'APPROVED' },
          created_at: '2026-11-20T11:00:00Z',
          users: { full_name: 'Carlos Gómez', email: 'carlos@empresa.com' },
          documents: { code: 'SGC-PR-001', title: 'Manual de Calidad', version: 1 },
        },
        {
          id: 'log-b',
          user_id: 'usr-1',
          document_id: 2,
          action: 'DOCUMENT_APPROVED',
          details: { old_status: 'REVIEWED', new_status: 'APPROVED' },
          created_at: '2026-11-20T09:00:00Z',
          users: { full_name: 'Carlos Gómez', email: 'carlos@empresa.com' },
          documents: { code: 'SGC-IT-099', title: 'Instructivo Auxiliar', version: 0 },
        },
      ];

      const queryBuilder = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValueOnce({ data: rawRows, error: null }),
      };

      const fromSpy = vi
        .spyOn(service.supabase, 'from')
        .mockReturnValueOnce(queryBuilder as unknown as ReturnType<typeof service.supabase.from>);

      const logs = await service.getAuditLogs({
        userId: 'usr-1',
        action: 'DOCUMENT_APPROVED',
        dateFrom: new Date('2026-11-20T00:00:00'),
        dateTo: new Date('2026-11-20T23:59:59'),
        documentQuery: 'manual',
      });

      expect(fromSpy).toHaveBeenCalledWith('audit_logs');
      expect(queryBuilder.eq).toHaveBeenCalledWith('user_id', 'usr-1');
      expect(queryBuilder.eq).toHaveBeenCalledWith('action', 'DOCUMENT_APPROVED');
      expect(queryBuilder.gte).toHaveBeenCalledWith('created_at', expect.any(String));
      expect(queryBuilder.lte).toHaveBeenCalledWith('created_at', expect.any(String));
      expect(logs).toHaveLength(1);
      expect(logs[0].doc_code).toBe('SGC-PR-001');
      expect(service.auditLogs()).toEqual(logs);
      expect(service.auditLogsLoading()).toBe(false);
    });
  });
});

