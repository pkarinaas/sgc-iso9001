import { PDFDocument } from 'pdf-lib';
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

      // Verify insert used version 0 as number and null for missing process_area
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        title: 'New Doc',
        code: 'PE-03',
        version: 0,
        process_area: null,
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
        process_area: null,
        file_url: 'https://example.com/PE-03_Procedimiento_v02.pdf',
      });
    });
  });

  describe('extractFilePath (SCRUM-54)', () => {
    it('should return empty string if input is empty or null', () => {
      expect(service.extractFilePath('')).toBe('');
      expect(service.extractFilePath(null as any)).toBe('');
      expect(service.extractFilePath(undefined as any)).toBe('');
    });

    it('should return the relative path as-is if not an HTTP/HTTPS URL', () => {
      expect(service.extractFilePath('PE-03_Title_v00.pdf')).toBe('PE-03_Title_v00.pdf');
      expect(service.extractFilePath('subfolder/document.pdf')).toBe('subfolder/document.pdf');
    });

    it('should extract filename from full Supabase URL containing /sgc-files/', () => {
      const fullUrl = 'https://proj.supabase.co/storage/v1/object/public/sgc-files/PE-03_Title_v00.pdf';
      expect(service.extractFilePath(fullUrl)).toBe('PE-03_Title_v00.pdf');
    });

    it('should extract nested path from full Supabase URL containing /sgc-files/', () => {
      const fullUrl = 'https://proj.supabase.co/storage/v1/object/public/sgc-files/reports/2026/doc_v01.pdf';
      expect(service.extractFilePath(fullUrl)).toBe('reports/2026/doc_v01.pdf');
    });

    it('should strip query parameters and decode URL encoded characters', () => {
      const fullUrl = 'https://proj.supabase.co/storage/v1/object/public/sgc-files/PE-03%20Manual%20Calidad_v00.pdf?token=secret123';
      expect(service.extractFilePath(fullUrl)).toBe('PE-03 Manual Calidad_v00.pdf');
    });
  });

  describe('getSignedDocumentUrl (SCRUM-54)', () => {
    it('should return null if filePath is empty', async () => {
      const storageSpy = vi.spyOn(supabase.storage, 'from');
      const result = await service.getSignedDocumentUrl('');

      expect(result).toBeNull();
      expect(storageSpy).not.toHaveBeenCalled();
    });

    it('should call createSignedUrl with bucket sgc-files and 60 seconds expiration', async () => {
      const createSignedUrlMock = vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://proj.supabase.co/storage/v1/object/sign/sgc-files/doc.pdf?token=xyz' },
        error: null,
      });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        createSignedUrl: createSignedUrlMock,
      } as any);

      const result = await service.getSignedDocumentUrl('https://proj.supabase.co/storage/v1/object/public/sgc-files/doc.pdf');

      expect(supabase.storage.from).toHaveBeenCalledWith('sgc-files');
      expect(createSignedUrlMock).toHaveBeenCalledWith('doc.pdf', 60);
      expect(result).toBe('https://proj.supabase.co/storage/v1/object/sign/sgc-files/doc.pdf?token=xyz');
    });

    it('should handle Supabase storage error gracefully and return null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const createSignedUrlMock = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Object not found' },
      });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        createSignedUrl: createSignedUrlMock,
      } as any);

      const result = await service.getSignedDocumentUrl('missing-file.pdf');

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('Error creating signed URL for document:', 'Object not found');
      consoleSpy.mockRestore();
    });

    it('should handle unexpected exception gracefully and return null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(supabase.storage, 'from').mockImplementation(() => {
        throw new Error('Network failure');
      });

      const result = await service.getSignedDocumentUrl('doc.pdf');

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('downloadWatermarkedDocument (Secure Download)', () => {
    it('should throw error if filePath is empty', async () => {
      await expect(service.downloadWatermarkedDocument('')).rejects.toThrow(
        'No se proporcionó una ruta de archivo válida.',
      );
    });

    it('should throw error if storage download fails', async () => {
      const downloadMock = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Object not found' },
      });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        download: downloadMock,
      } as any);

      await expect(
        service.downloadWatermarkedDocument('PE-03.pdf', 'PE-03'),
      ).rejects.toThrow('Error al descargar el archivo');
    });

    it('should download original PDF, watermark pages, and trigger client-side download with correct filename', async () => {
      const sampleDoc = await PDFDocument.create();
      sampleDoc.addPage([595, 842]);
      const sampleBytes = await sampleDoc.save();
      const sampleBlob = new Blob([sampleBytes as unknown as BlobPart], { type: 'application/pdf' });

      const downloadMock = vi.fn().mockResolvedValue({
        data: sampleBlob,
        error: null,
      });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        download: downloadMock,
      } as any);

      const createObjectURLSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:http://localhost/mock-blob-url');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      let createdAnchor: HTMLAnchorElement | null = null;
      const originalCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = originalCreateElement(tagName);
        if (tagName === 'a') {
          createdAnchor = el as HTMLAnchorElement;
          vi.spyOn(createdAnchor, 'click').mockImplementation(() => {});
        }
        return el;
      });

      await service.downloadWatermarkedDocument(
        'https://supabase.co/storage/v1/object/public/sgc-files/PE-03_Title_v00.pdf',
        'PE-03',
        'Control Calidad',
      );

      expect(supabase.storage.from).toHaveBeenCalledWith('sgc-files');
      expect(downloadMock).toHaveBeenCalledWith('PE-03_Title_v00.pdf');
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(createdAnchor).not.toBeNull();
      const anchor = createdAnchor as unknown as HTMLAnchorElement;
      expect(anchor.download).toBe('PE-03_Control_Calidad_COPIA_NO_CONTROLADA.pdf');
      expect(anchor.href).toBe('blob:http://localhost/mock-blob-url');
      expect(anchor.click).toHaveBeenCalled();

      createElementSpy.mockRestore();
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
    });
  });
});
