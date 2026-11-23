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
});

