import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DocumentService } from './document.service';
import { supabase } from '../supabase/supabase.client';

describe('DocumentService - Versioning & Creation (SCRUM-20 Subtask 4)', () => {
  let service: DocumentService;

  beforeEach(() => {
    vi.restoreAllMocks();
    TestBed.configureTestingModule({
      providers: [DocumentService],
    });
    service = TestBed.inject(DocumentService);
  });

  describe('getNextVersionForCode', () => {
    it('should return 0 when code is empty or whitespace', async () => {
      const fromSpy = vi.spyOn(supabase, 'from');

      expect(await service.getNextVersionForCode('')).toBe(0);
      expect(await service.getNextVersionForCode('   ')).toBe(0);
      expect(fromSpy).not.toHaveBeenCalled();
    });

    it('should return 0 when no prior document with the code exists', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      vi.spyOn(supabase, 'from').mockReturnValue(mockQueryBuilder as any);

      const nextVersion = await service.getNextVersionForCode('PE-03');

      expect(supabase.from).toHaveBeenCalledWith('documents');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('version');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('code', 'PE-03');
      expect(mockQueryBuilder.order).toHaveBeenCalledWith('version', { ascending: false });
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(1);
      expect(nextVersion).toBe(0);
    });

    it('should return max(version) + 1 when previous version exists', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [{ version: 2 }], error: null }),
      };
      vi.spyOn(supabase, 'from').mockReturnValue(mockQueryBuilder as any);

      const nextVersion = await service.getNextVersionForCode('PE-03');

      expect(nextVersion).toBe(3);
    });
  });

  describe('createDocument', () => {
    it('should query max version, assign 0 if not found, and insert integer version into DB', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
      vi.spyOn(supabase, 'from').mockReturnValue(mockQueryBuilder as any);

      const uploadMock = vi.fn().mockResolvedValue({ error: null });
      const getPublicUrlMock = vi.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/PE-03_New_Doc_v00.pdf' },
      });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      } as any);

      const dummyFile = new File(['dummy content'], 'doc.pdf', { type: 'application/pdf' });

      await service.createDocument(dummyFile, {
        title: 'New Doc',
        code: 'PE-03',
      });

      // Verify version query was executed for code
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('version');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('code', 'PE-03');

      // Verify file upload used v00
      expect(uploadMock).toHaveBeenCalledWith(
        'PE-03_New_Doc_v00.pdf',
        dummyFile,
        { upsert: true },
      );

      // Verify insert used version 0 as number
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        title: 'New Doc',
        code: 'PE-03',
        version: 0,
        file_url: 'https://example.com/PE-03_New_Doc_v00.pdf',
      });
    });

    it('should calculate max(version) + 1, format v02, and insert integer version when older version exists', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [{ version: 1 }], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
      vi.spyOn(supabase, 'from').mockReturnValue(mockQueryBuilder as any);

      const uploadMock = vi.fn().mockResolvedValue({ error: null });
      const getPublicUrlMock = vi.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/PE-03_Procedimiento_v02.pdf' },
      });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      } as any);

      const dummyFile = new File(['dummy content'], 'doc.pdf', { type: 'application/pdf' });

      await service.createDocument(dummyFile, {
        title: 'Procedimiento',
        code: 'PE-03',
      });

      // Upload should have formatted filename with next version 'v02'
      expect(uploadMock).toHaveBeenCalledWith(
        'PE-03_Procedimiento_v02.pdf',
        dummyFile,
        { upsert: true },
      );

      // Database insert must store version as integer 2
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        title: 'Procedimiento',
        code: 'PE-03',
        version: 2,
        file_url: 'https://example.com/PE-03_Procedimiento_v02.pdf',
      });
    });
  });
});