import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FilterService, MessageService, ConfirmationService, type Confirmation } from 'primeng/api';
import type { Table } from 'primeng/table';
import type { Select } from 'primeng/select';

const mockSavePdf = vi.fn();
vi.mock('jspdf', () => {
  return {
    default: class MockJsPDF {
      setFontSize = vi.fn();
      setTextColor = vi.fn();
      text = vi.fn();
      save = mockSavePdf;
    },
  };
});

const mockAutoTable = vi.fn();
vi.mock('jspdf-autotable', () => ({
  default: (...args: unknown[]) => mockAutoTable(...args),
}));

const mockSaveAs = vi.fn();
vi.mock('file-saver', () => ({
  saveAs: (...args: unknown[]) => mockSaveAs(...args),
}));

import * as XLSX from 'xlsx';
import { DocumentListComponent } from './document-list';
import { AuthService } from '../../../core/services/auth.service';
import { DocumentService } from '../../../core/services/document.service';
import type { Document, DriveSyncSnapshot } from '../../../core/models/document.model';

describe('DocumentListComponent', () => {
  let component: DocumentListComponent;
  let fixture: ComponentFixture<DocumentListComponent>;

  const mockDocuments: Document[] = [
    {
      id: 'doc-1',
      code: 'SGC-MAN-001',
      title: 'Manual de Calidad',
      version: 1,
      status: 'APPROVED',
      file_url: 'https://storage.supabase.com/docs/manual.pdf',
      creator_id: 'usr-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const mockAuthService = {
    getUserRole: vi.fn().mockResolvedValue('ADMIN'),
    userRole: signal<string | null>('ADMIN'),
  };

  const mockDocumentService = {
    documents: signal<Document[]>(mockDocuments),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    loadDocuments: vi.fn().mockResolvedValue(undefined),
    createDocument: vi.fn().mockResolvedValue(undefined),
    updateDocument: vi.fn().mockResolvedValue(undefined),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    updateDocumentStatus: vi.fn().mockResolvedValue(undefined),
    retryDriveSync: vi.fn().mockResolvedValue(undefined),
    getDriveSyncStatus: vi.fn().mockResolvedValue(null),
    updateLocalDriveSyncState: vi.fn(),
    getNextVersionForCode: vi.fn().mockResolvedValue(1),
    getSignedDocumentUrl: vi
      .fn()
      .mockResolvedValue('https://storage.supabase.com/signed/manual.pdf'),
    downloadWatermarkedDocument: vi.fn().mockResolvedValue(undefined),
  };

  let mockMessageService: MessageService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDocumentService.documents.set([...mockDocuments]);
    mockDocumentService.retryDriveSync.mockResolvedValue(undefined);
    mockDocumentService.getDriveSyncStatus.mockResolvedValue(null);
    mockDocumentService.updateLocalDriveSyncState.mockImplementation(
      (documentId: number | string, snapshot: DriveSyncSnapshot) => {
        const targetId = String(documentId);
        mockDocumentService.documents.update((docs) =>
          docs.map((doc) =>
            String(doc.id) === targetId
              ? {
                  ...doc,
                  drive_sync_status: snapshot.drive_sync_status,
                  drive_file_id: snapshot.drive_file_id,
                  drive_sync_error:
                    snapshot.drive_sync_status === 'SYNCED' ? null : snapshot.drive_sync_error,
                  drive_synced_at: snapshot.drive_synced_at,
                }
              : doc,
          ),
        );
      },
    );
    mockAuthService.getUserRole.mockResolvedValue('ADMIN');
    mockDocumentService.getSignedDocumentUrl.mockResolvedValue(
      'https://storage.supabase.com/signed/manual.pdf',
    );
    mockDocumentService.downloadWatermarkedDocument.mockResolvedValue(undefined);
    mockMessageService = new MessageService();
    vi.spyOn(mockMessageService, 'add');
    await TestBed.configureTestingModule({
      imports: [DocumentListComponent],
      providers: [
        provideNoopAnimations(),
        FilterService,
        ConfirmationService,
        { provide: AuthService, useValue: mockAuthService },
        { provide: DocumentService, useValue: mockDocumentService },
        { provide: MessageService, useValue: mockMessageService },
      ],
    })
      .overrideComponent(DocumentListComponent, {
        set: {
          providers: [
            { provide: MessageService, useValue: mockMessageService },
            ConfirmationService,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DocumentListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // Component lifecycle

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize dialog state and form controls correctly', () => {
    expect(component.isDialogVisible).toBe(false);
    expect(component.isSubmitting).toBe(false);

    expect(component.documentForm.get('title')?.value).toBe('');
    expect(component.documentForm.get('code')?.value).toBe('');
    expect(component.documentForm.get('file')?.value).toBeNull();
    expect(component.documentForm.invalid).toBe(true);
  });

  // Form validation

  it('should validate that title and file are required', () => {
    const titleCtrl = component.documentForm.get('title');
    const fileCtrl = component.documentForm.get('file');

    expect(titleCtrl?.valid).toBe(false);
    expect(titleCtrl?.hasError('required')).toBe(true);

    expect(fileCtrl?.valid).toBe(false);
    expect(fileCtrl?.hasError('required')).toBe(true);
  });

  it('should mark the file control as valid when the selected file is under the 5 MB limit', () => {
    // 2 MB – well within the 5 MB (5_242_880 bytes) limit
    const twoMB = 2 * 1024 * 1024; // 2_097_152 bytes
    const smallFile = new File([new ArrayBuffer(twoMB)], 'small-doc.pdf', {
      type: 'application/pdf',
    });

    component.documentForm.get('file')?.setValue(smallFile);
    component.documentForm.get('file')?.updateValueAndValidity();

    expect(component.documentForm.get('file')?.valid).toBe(true);
    expect(component.documentForm.get('file')?.hasError('maxSize')).toBe(false);
  });

  it('should mark the file control as invalid with a maxSize error when the file exceeds 5 MB', () => {
    // 6 MB – exceeds the 5 MB (5_242_880 bytes) limit
    const sixMB = 6 * 1024 * 1024; // 6_291_456 bytes
    const largeFile = new File([new ArrayBuffer(sixMB)], 'large-doc.pdf', {
      type: 'application/pdf',
    });

    component.documentForm.get('file')?.setValue(largeFile);
    component.documentForm.get('file')?.updateValueAndValidity();

    const fileCtrl = component.documentForm.get('file');
    expect(fileCtrl?.valid).toBe(false);
    expect(fileCtrl?.hasError('maxSize')).toBe(true);

    const error = fileCtrl?.getError('maxSize');
    expect(error?.actual).toBe(sixMB);
    expect(error?.max).toBe(DocumentListComponent.MAX_FILE_SIZE_BYTES);
  });

  // Dialog state

  it('should open upload dialog and reset the form when openUploadDialog is called', () => {
    component.documentForm.patchValue({
      title: 'Procedimiento de Auditoría',
      code: 'SGC-PRC-002',
      file: new File(['content'], 'test.pdf', { type: 'application/pdf' }),
    });

    component.openUploadDialog();

    expect(component.isDialogVisible).toBe(true);
    expect(component.documentForm.get('title')?.value).toBe('');
    expect(component.documentForm.get('code')?.value).toBe('');
    expect(component.documentForm.get('process_area')?.value).toBe('');
    expect(component.documentForm.get('file')?.value).toBeNull();
  });

  it('should close upload dialog when closeUploadDialog is called', () => {
    component.isDialogVisible = true;
    component.closeUploadDialog();
    expect(component.isDialogVisible).toBe(false);
  });

  // File selection

  it('should assign selected file to documentForm when onFileSelect is triggered', () => {
    const fakeFile = new File(['fake content'], 'sgc-doc.pdf', { type: 'application/pdf' });
    const selectEvent = { files: [fakeFile] };

    component.onFileSelect(selectEvent);

    expect(component.documentForm.get('file')?.value).toBe(fakeFile);
    expect(component.documentForm.get('file')?.valid).toBe(true);
  });

  it('should mark form valid when all required fields (title, process_area, valid-size file) are provided', () => {
    const fakeFile = new File(['dummy'], 'norma.pdf', { type: 'application/pdf' });

    component.documentForm.patchValue({
      title: 'Política de Calidad',
      code: 'SGC-POL-001',
      process_area: 'control_calidad',
      file: fakeFile,
    });

    expect(component.documentForm.valid).toBe(true);
  });

  // Display helpers

  it('should correctly format version strings and numbers', () => {
    expect(component.formatVersion('00')).toBe('v00');
    expect(component.formatVersion('01')).toBe('v01');
    expect(component.formatVersion('v02')).toBe('v02');
    expect(component.formatVersion(0)).toBe('v00');
    expect(component.formatVersion(1)).toBe('v01');
    expect(component.formatVersion(1.5)).toBe('v1.5');
  });

  // Filter state & methods

  it('should initialize selectedStatus to null and statusOptions with "Todos los estados"', () => {
    expect(component.selectedStatus).toBeNull();
    expect(component.statusOptions[0]).toEqual({ label: 'Todos los estados', value: null });
    expect(
      component.statusOptions.some((opt) => opt.value === 'REVIEWED' && opt.label === 'Revisado'),
    ).toBe(true);
    expect(component.getStatusLabel('REVIEWED')).toBe('Revisado');
  });

  it('should update selectedStatus and filter documents table on status change', () => {
    const filterSpy = vi.fn();
    const mockTable = { filter: filterSpy } as unknown as Table;

    component.onStatusChange({ value: 'APPROVED' }, mockTable);

    expect(component.selectedStatus).toBe('APPROVED');
    expect(filterSpy).toHaveBeenCalledWith('APPROVED', 'status', 'equals');

    component.onStatusChange({ value: null }, mockTable);
    expect(component.selectedStatus).toBeNull();
    expect(filterSpy).toHaveBeenCalledWith(null, 'status', 'equals');
  });

  it('should call hide on the select component when onStatusChange is triggered', () => {
    const filterSpy = vi.fn();
    const mockTable = { filter: filterSpy } as unknown as Table;
    const mockSelect = { hide: vi.fn() } as unknown as Select;

    component.onStatusChange({ value: 'REVIEWED' }, mockTable, mockSelect);

    expect(mockSelect.hide).toHaveBeenCalled();
  });

  // Deletion logic and permissions

  it('should allow deletion only for DRAFT and REVIEWED documents', () => {
    const draftDoc = { ...mockDocuments[0], status: 'DRAFT' as const };
    const reviewedDoc = { ...mockDocuments[0], status: 'REVIEWED' as const };
    const approvedDoc = { ...mockDocuments[0], status: 'APPROVED' as const };
    const obsoleteDoc = { ...mockDocuments[0], status: 'OBSOLETE' as const };

    expect(component.canDelete(draftDoc)).toBe(true);
    expect(component.canDelete(reviewedDoc)).toBe(true);
    expect(component.canDelete(approvedDoc)).toBe(false);
    expect(component.canDelete(obsoleteDoc)).toBe(false);
  });

  it('should trigger confirmation dialog with correct configuration on confirmDelete', () => {
    const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi.spyOn(confirmationService, 'confirm');

    const draftDoc = { ...mockDocuments[0], status: 'DRAFT' as const };
    component.confirmDelete(draftDoc);

    expect(confirmSpy).toHaveBeenCalledOnce();
    const config = confirmSpy.mock.calls[0][0];
    expect(config.header).toBe('Confirmar Eliminación');
    expect(config.message).toBe('¿Estás seguro de que deseas eliminar este documento?');
    expect(config.accept).toBeDefined();
    expect(config.acceptButtonStyleClass).toBe('btn-confirm-accept');
    expect(config.rejectButtonStyleClass).toBe('btn-confirm-cancel');
    expect(config.acceptButtonProps).toEqual({ severity: 'primary' });
    expect(config.rejectButtonProps).toEqual({ severity: 'secondary', text: true });
  });

  it('should call deleteDocument, show success toast and reload documents when delete is accepted', async () => {
    const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    let acceptCallback: (() => unknown) | undefined;
    vi.spyOn(confirmationService, 'confirm').mockImplementation((config: Confirmation) => {
      acceptCallback = config.accept as (() => unknown) | undefined;
      return confirmationService;
    });

    const draftDoc = { ...mockDocuments[0], id: 'doc-99', status: 'DRAFT' as const };
    component.confirmDelete(draftDoc);

    expect(acceptCallback).toBeDefined();
    await acceptCallback!();

    expect(mockDocumentService.deleteDocument).toHaveBeenCalledWith('doc-99');
    expect(mockMessageService.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: 'Éxito',
        detail: 'Documento eliminado correctamente',
      }),
    );
    expect(mockDocumentService.loadDocuments).toHaveBeenCalled();
  });

  it('should display error toast when deleteDocument fails', async () => {
    mockDocumentService.deleteDocument.mockRejectedValueOnce(
      new Error('Violates row-level security policy'),
    );
    const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    let acceptCallback: (() => unknown) | undefined;
    vi.spyOn(confirmationService, 'confirm').mockImplementation((config: Confirmation) => {
      acceptCallback = config.accept as (() => unknown) | undefined;
      return confirmationService;
    });

    const draftDoc = { ...mockDocuments[0], id: 'doc-99', status: 'DRAFT' as const };
    component.confirmDelete(draftDoc);

    expect(acceptCallback).toBeDefined();
    await acceptCallback!();

    expect(mockMessageService.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Error',
      }),
    );
  });

  // Status modal & update tests

  it('should correctly open status modal with filtered states based on current status', () => {
    // DRAFT -> only REVIEWED
    const draftDoc = { ...mockDocuments[0], status: 'DRAFT' as const };
    component.openStatusModal(draftDoc);
    expect(component.isStatusModalVisible).toBe(true);
    expect(component.documentToChange).toEqual(draftDoc);
    expect(component.availableStates).toEqual([{ label: 'Revisado', value: 'REVIEWED' }]);
    expect(component.selectedNewStatus).toBe('REVIEWED');

    // REVIEWED -> APPROVED or DRAFT
    const reviewedDoc = { ...mockDocuments[0], status: 'REVIEWED' as const };
    component.openStatusModal(reviewedDoc);
    expect(component.availableStates).toEqual([
      { label: 'Aprobado', value: 'APPROVED' },
      { label: 'Borrador', value: 'DRAFT' },
    ]);
    expect(component.selectedNewStatus).toBe('APPROVED');

    // APPROVED -> OBSOLETE
    const approvedDoc = { ...mockDocuments[0], status: 'APPROVED' as const };
    component.openStatusModal(approvedDoc);
    expect(component.availableStates).toEqual([{ label: 'Obsoleto', value: 'OBSOLETE' }]);
    expect(component.selectedNewStatus).toBe('OBSOLETE');

    // OBSOLETE -> none
    const obsoleteDoc = { ...mockDocuments[0], status: 'OBSOLETE' as const };
    component.openStatusModal(obsoleteDoc);
    expect(component.availableStates).toEqual([]);
    expect(component.selectedNewStatus).toBeNull();
  });

  it('should reset state when closeStatusModal is called', () => {
    const draftDoc = { ...mockDocuments[0], status: 'DRAFT' as const };
    component.openStatusModal(draftDoc);
    expect(component.isStatusModalVisible).toBe(true);

    component.closeStatusModal();
    expect(component.isStatusModalVisible).toBe(false);
    expect(component.documentToChange).toBeNull();
    expect(component.selectedNewStatus).toBeNull();
    expect(component.availableStates).toEqual([]);
  });

  it('should call updateDocumentStatus, display success toast, close modal, and reload documents on saveStatus', async () => {
    const draftDoc = { ...mockDocuments[0], id: 'doc-123', status: 'DRAFT' as const };
    component.openStatusModal(draftDoc);

    await component.saveStatus();

    expect(mockDocumentService.updateDocumentStatus).toHaveBeenCalledWith('doc-123', 'REVIEWED');
    expect(mockMessageService.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: 'Éxito',
        detail: 'Estado actualizado',
      }),
    );
    expect(component.isStatusModalVisible).toBe(false);
    expect(mockDocumentService.loadDocuments).toHaveBeenCalled();
  });

  it('should display error toast when saveStatus fails', async () => {
    mockDocumentService.updateDocumentStatus.mockRejectedValueOnce(new Error('Update failed'));
    const draftDoc = { ...mockDocuments[0], id: 'doc-123', status: 'DRAFT' as const };
    component.openStatusModal(draftDoc);

    await component.saveStatus();

    expect(mockMessageService.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Error',
      }),
    );
    expect(component.isUpdatingStatus).toBe(false);
  });

  // Automated Versioning & Upload without manual version field

  it('should allow entering an existing code without validation error', () => {
    const codeCtrl = component.documentForm.get('code');
    codeCtrl?.setValue('SGC-MAN-001');
    expect(codeCtrl?.valid).toBe(true);
    expect(codeCtrl?.errors).toBeNull();
  });

  it('should call createDocument with title, code, and process_area without manual version on saveDocument', async () => {
    const fakeFile = new File(['dummy'], 'norma.pdf', { type: 'application/pdf' });
    component.documentForm.patchValue({
      title: 'Política de Calidad',
      code: 'SGC-POL-001',
      process_area: 'control_calidad',
      file: fakeFile,
    });

    await component.saveDocument();

    expect(mockDocumentService.createDocument).toHaveBeenCalledWith(fakeFile, {
      title: 'Política de Calidad',
      code: 'SGC-POL-001',
      process_area: 'control_calidad',
    });
    expect(mockMessageService.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: 'Documento guardado',
      }),
    );
    expect(component.isDialogVisible).toBe(false);
  });

  // Role-based actions and obsolete filtering

  describe('Default Obsolete Filtering', () => {
    it('should hide OBSOLETE documents by default when selectedStatus is null', () => {
      const mixedDocs: Document[] = [
        { ...mockDocuments[0], id: 'doc-draft', status: 'DRAFT' },
        { ...mockDocuments[0], id: 'doc-reviewed', status: 'REVIEWED' },
        { ...mockDocuments[0], id: 'doc-approved', status: 'APPROVED' },
        { ...mockDocuments[0], id: 'doc-obsolete', status: 'OBSOLETE' },
      ];
      mockDocumentService.documents.set(mixedDocs);
      component.selectedStatus = null;

      const displayed = component.displayedDocuments;

      expect(displayed.length).toBe(3);
      expect(displayed.some((d) => d.status === 'OBSOLETE')).toBe(false);
      expect(displayed.map((d) => d.status)).toEqual(['DRAFT', 'REVIEWED', 'APPROVED']);
    });

    it('should include OBSOLETE documents when selectedStatus is explicitly OBSOLETE', () => {
      const mixedDocs: Document[] = [
        { ...mockDocuments[0], id: 'doc-approved', status: 'APPROVED' },
        { ...mockDocuments[0], id: 'doc-obsolete', status: 'OBSOLETE' },
      ];
      mockDocumentService.documents.set(mixedDocs);
      component.selectedStatus = 'OBSOLETE';

      const displayed = component.displayedDocuments;

      expect(displayed.length).toBe(2);
      expect(displayed.some((d) => d.status === 'OBSOLETE')).toBe(true);
    });
  });

  describe('Role-Based Action Logic', () => {
    const draftDoc: Document = { ...mockDocuments[0], id: 'd-1', status: 'DRAFT' };
    const reviewedDoc: Document = { ...mockDocuments[0], id: 'd-2', status: 'REVIEWED' };
    const approvedDoc: Document = { ...mockDocuments[0], id: 'd-3', status: 'APPROVED' };
    const obsoleteDoc: Document = { ...mockDocuments[0], id: 'd-4', status: 'OBSOLETE' };

    it('canViewActions should return false for VIEWER and true for other roles', () => {
      expect(component.canViewActions('VIEWER')).toBe(false);
      expect(component.canViewActions('ADMIN')).toBe(true);
      expect(component.canViewActions('EDITOR')).toBe(true);
      expect(component.canViewActions('REVIEWER')).toBe(true);
      expect(component.canViewActions('APPROVER')).toBe(true);
    });

    it('canDelete should return false for VIEWER for all document states', () => {
      expect(component.canDelete(draftDoc, 'VIEWER')).toBe(false);
      expect(component.canDelete(reviewedDoc, 'VIEWER')).toBe(false);
      expect(component.canDelete(approvedDoc, 'VIEWER')).toBe(false);
      expect(component.canDelete(obsoleteDoc, 'VIEWER')).toBe(false);
    });

    it('canDelete should return true for allowed roles only on DRAFT and REVIEWED documents', () => {
      ['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER'].forEach((role) => {
        expect(component.canDelete(draftDoc, role)).toBe(true);
        expect(component.canDelete(reviewedDoc, role)).toBe(true);
        // Traceability rule: NO ONE can delete APPROVED or OBSOLETE
        expect(component.canDelete(approvedDoc, role)).toBe(false);
        expect(component.canDelete(obsoleteDoc, role)).toBe(false);
      });
    });

    it('canChangeStatus should return false for VIEWER for all states', () => {
      expect(component.canChangeStatus(draftDoc, 'VIEWER')).toBe(false);
      expect(component.canChangeStatus(reviewedDoc, 'VIEWER')).toBe(false);
      expect(component.canChangeStatus(approvedDoc, 'VIEWER')).toBe(false);
      expect(component.canChangeStatus(obsoleteDoc, 'VIEWER')).toBe(false);
    });

    it('canChangeStatus should return false for OBSOLETE documents for all roles', () => {
      ['ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER', 'VIEWER'].forEach((role) => {
        expect(component.canChangeStatus(obsoleteDoc, role)).toBe(false);
      });
    });

    it('canChangeStatus for EDITOR: only allows transitioning DRAFT documents', () => {
      expect(component.canChangeStatus(draftDoc, 'EDITOR')).toBe(true);
      expect(component.canChangeStatus(reviewedDoc, 'EDITOR')).toBe(false);
      expect(component.canChangeStatus(approvedDoc, 'EDITOR')).toBe(false);
    });

    it('canChangeStatus for REVIEWER: allows transitioning DRAFT and REVIEWED documents', () => {
      expect(component.canChangeStatus(draftDoc, 'REVIEWER')).toBe(true);
      expect(component.canChangeStatus(reviewedDoc, 'REVIEWER')).toBe(true);
      expect(component.canChangeStatus(approvedDoc, 'REVIEWER')).toBe(false);
    });

    it('canChangeStatus for APPROVER: allows transitioning REVIEWED and APPROVED documents', () => {
      expect(component.canChangeStatus(draftDoc, 'APPROVER')).toBe(false);
      expect(component.canChangeStatus(reviewedDoc, 'APPROVER')).toBe(true);
      expect(component.canChangeStatus(approvedDoc, 'APPROVER')).toBe(true);
    });

    it('canChangeStatus for ADMIN: allows transitioning DRAFT, REVIEWED, and APPROVED documents', () => {
      expect(component.canChangeStatus(draftDoc, 'ADMIN')).toBe(true);
      expect(component.canChangeStatus(reviewedDoc, 'ADMIN')).toBe(true);
      expect(component.canChangeStatus(approvedDoc, 'ADMIN')).toBe(true);
    });

    it('should not render upload, status, or delete buttons in DOM when role is VIEWER', () => {
      component.currentUserRole = 'VIEWER';
      fixture.detectChanges();

      const uploadBtn = fixture.nativeElement.querySelector('#btn-upload-document');
      const statusBtn = fixture.nativeElement.querySelector('#btn-status-' + mockDocuments[0].id);
      const deleteBtn = fixture.nativeElement.querySelector('#btn-delete-' + mockDocuments[0].id);
      const editBtn = fixture.nativeElement.querySelector('#btn-edit-' + mockDocuments[0].id);

      expect(uploadBtn).toBeNull();
      expect(statusBtn).toBeNull();
      expect(deleteBtn).toBeNull();
      expect(editBtn).toBeNull();
    });
  });

  // PDF Viewer Integration & Secure Signed URLs
  describe('PDF Viewer Integration & Secure Access', () => {
    it('should fetch signed URL, set currentPdfUrl to signed URL, and open dialog when openPdfViewer is called', async () => {
      const doc = mockDocuments[0];
      mockDocumentService.getSignedDocumentUrl.mockResolvedValueOnce(
        'https://signed-url.com/manual.pdf',
      );

      await component.openPdfViewer(doc);

      expect(mockDocumentService.getSignedDocumentUrl).toHaveBeenCalledWith(doc.file_url);
      expect(component.currentPdfUrl).toBe('https://signed-url.com/manual.pdf');
      expect(component.isPdfViewerVisible).toBe(true);
      expect(component.isLoadingPdf).toBe(false);
    });

    it('should display error toast and not open dialog when getSignedDocumentUrl returns null', async () => {
      const doc = mockDocuments[0];
      mockDocumentService.getSignedDocumentUrl.mockResolvedValueOnce(null);

      await component.openPdfViewer(doc);

      expect(mockDocumentService.getSignedDocumentUrl).toHaveBeenCalledWith(doc.file_url);
      expect(component.isPdfViewerVisible).toBe(false);
      expect(component.currentPdfUrl).toBeNull();
      expect(component.isLoadingPdf).toBe(false);
      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Error',
          detail: 'Error al cargar el documento seguro',
          life: 5000,
        }),
      );
    });

    it('should display error toast and reset isLoadingPdf when getSignedDocumentUrl throws', async () => {
      const doc = mockDocuments[0];
      mockDocumentService.getSignedDocumentUrl.mockRejectedValueOnce(new Error('Network failure'));

      await component.openPdfViewer(doc);

      expect(component.isPdfViewerVisible).toBe(false);
      expect(component.isLoadingPdf).toBe(false);
      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Error',
          detail: 'Error al cargar el documento seguro',
          life: 5000,
        }),
      );
    });

    it('should ignore duplicate calls while isLoadingPdf is true', async () => {
      const doc = mockDocuments[0];
      component.isLoadingPdf = true;

      await component.openPdfViewer(doc);

      expect(mockDocumentService.getSignedDocumentUrl).not.toHaveBeenCalled();
    });

    it('should not attempt to fetch signed URL if document has no file_url', async () => {
      const docWithoutUrl = { ...mockDocuments[0], file_url: '' };

      await component.openPdfViewer(docWithoutUrl);

      expect(mockDocumentService.getSignedDocumentUrl).not.toHaveBeenCalled();
      expect(component.isPdfViewerVisible).toBe(false);
    });

    it('should close PDF viewer dialog and reset currentPdfUrl when closePdfViewer is called', () => {
      component.isPdfViewerVisible = true;
      component.currentPdfUrl = 'https://example.com/test.pdf';

      component.closePdfViewer();

      expect(component.isPdfViewerVisible).toBe(false);
      expect(component.currentPdfUrl).toBeNull();
    });

    it('should bind the view button to openPdfViewer with document and disable it when isLoadingPdf is true', () => {
      component.currentUserRole = 'ADMIN';
      mockDocumentService.documents.set([...mockDocuments]);
      fixture.detectChanges();

      const openSpy = vi.spyOn(component, 'openPdfViewer');
      const viewBtn = fixture.nativeElement.querySelector(
        '#btn-view-' + mockDocuments[0].id,
      ) as HTMLButtonElement;

      expect(viewBtn).not.toBeNull();
      expect(viewBtn.disabled).toBe(false);

      viewBtn.click();
      expect(openSpy).toHaveBeenCalledWith(mockDocuments[0]);

      component.isLoadingPdf = true;
      fixture.detectChanges();
      expect(viewBtn.disabled).toBe(true);
    });

    // PDF Viewer Security Restrictions
    describe('PDF Viewer Security Restrictions', () => {
      it('should prevent default on contextmenu event when isPdfViewerVisible is true', () => {
        component.isPdfViewerVisible = true;
        const event = new MouseEvent('contextmenu', { cancelable: true });
        const preventSpy = vi.spyOn(event, 'preventDefault');

        window.dispatchEvent(event);

        expect(preventSpy).toHaveBeenCalled();
      });

      it('should NOT prevent default on contextmenu event when isPdfViewerVisible is false', () => {
        component.isPdfViewerVisible = false;
        const event = new MouseEvent('contextmenu', { cancelable: true });
        const preventSpy = vi.spyOn(event, 'preventDefault');

        window.dispatchEvent(event);

        expect(preventSpy).not.toHaveBeenCalled();
      });

      it('should prevent default on Ctrl+P and Cmd+P when isPdfViewerVisible is true', () => {
        component.isPdfViewerVisible = true;

        const ctrlPEvent = new KeyboardEvent('keydown', {
          key: 'p',
          ctrlKey: true,
          cancelable: true,
        });
        const ctrlPreventSpy = vi.spyOn(ctrlPEvent, 'preventDefault');
        window.dispatchEvent(ctrlPEvent);
        expect(ctrlPreventSpy).toHaveBeenCalled();

        const cmdPEvent = new KeyboardEvent('keydown', {
          key: 'P',
          metaKey: true,
          cancelable: true,
        });
        const cmdPreventSpy = vi.spyOn(cmdPEvent, 'preventDefault');
        window.dispatchEvent(cmdPEvent);
        expect(cmdPreventSpy).toHaveBeenCalled();
      });

      it('should prevent default on Ctrl+S and Cmd+S when isPdfViewerVisible is true', () => {
        component.isPdfViewerVisible = true;

        const ctrlSEvent = new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: true,
          cancelable: true,
        });
        const ctrlPreventSpy = vi.spyOn(ctrlSEvent, 'preventDefault');
        window.dispatchEvent(ctrlSEvent);
        expect(ctrlPreventSpy).toHaveBeenCalled();

        const cmdSEvent = new KeyboardEvent('keydown', {
          key: 'S',
          metaKey: true,
          cancelable: true,
        });
        const cmdPreventSpy = vi.spyOn(cmdSEvent, 'preventDefault');
        window.dispatchEvent(cmdSEvent);
        expect(cmdPreventSpy).toHaveBeenCalled();
      });

      it('should NOT prevent default on other keyboard events when isPdfViewerVisible is true', () => {
        component.isPdfViewerVisible = true;

        const ctrlCEvent = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          cancelable: true,
        });
        const ctrlCPreventSpy = vi.spyOn(ctrlCEvent, 'preventDefault');
        window.dispatchEvent(ctrlCEvent);
        expect(ctrlCPreventSpy).not.toHaveBeenCalled();

        const plainPEvent = new KeyboardEvent('keydown', { key: 'p', cancelable: true });
        const plainPPreventSpy = vi.spyOn(plainPEvent, 'preventDefault');
        window.dispatchEvent(plainPEvent);
        expect(plainPPreventSpy).not.toHaveBeenCalled();
      });

      it('should NOT prevent default on Ctrl+P or Ctrl+S when isPdfViewerVisible is false', () => {
        component.isPdfViewerVisible = false;

        const ctrlPEvent = new KeyboardEvent('keydown', {
          key: 'p',
          ctrlKey: true,
          cancelable: true,
        });
        const ctrlPreventSpy = vi.spyOn(ctrlPEvent, 'preventDefault');
        window.dispatchEvent(ctrlPEvent);
        expect(ctrlPreventSpy).not.toHaveBeenCalled();

        const ctrlSEvent = new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: true,
          cancelable: true,
        });
        const ctrlSPreventSpy = vi.spyOn(ctrlSEvent, 'preventDefault');
        window.dispatchEvent(ctrlSEvent);
        expect(ctrlSPreventSpy).not.toHaveBeenCalled();
      });
    });

    // Secure Watermarked Download
    describe('Secure Watermarked Download', () => {
      it('should call downloadWatermarkedDocument, show info toast and success toast on onDownload', async () => {
        const doc = mockDocuments[0];

        await component.onDownload(doc);

        expect(mockDocumentService.downloadWatermarkedDocument).toHaveBeenCalledWith(
          doc.file_url,
          doc.code,
          doc.title,
        );
        expect(mockMessageService.add).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'info',
            summary: 'Descarga',
            detail: 'Preparando documento seguro...',
          }),
        );
        expect(mockMessageService.add).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'success',
            summary: 'Éxito',
            detail: 'Documento descargado con marca de agua.',
          }),
        );
        expect(component.downloadingDocId).toBeNull();
      });

      it('should show error toast and reset downloadingDocId when downloadWatermarkedDocument fails', async () => {
        const doc = mockDocuments[0];
        mockDocumentService.downloadWatermarkedDocument.mockRejectedValueOnce(
          new Error('Download failed'),
        );

        await component.onDownload(doc);

        expect(component.downloadingDocId).toBeNull();
        expect(mockMessageService.add).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'error',
            summary: 'Error al descargar',
          }),
        );
      });

      it('should ignore repeated calls while downloading the same document', async () => {
        const doc = mockDocuments[0];
        component.downloadingDocId = doc.id;

        await component.onDownload(doc);

        expect(mockDocumentService.downloadWatermarkedDocument).not.toHaveBeenCalled();
      });

      it('should ignore call if document has no file_url', async () => {
        const doc = { ...mockDocuments[0], file_url: '' };

        await component.onDownload(doc);

        expect(mockDocumentService.downloadWatermarkedDocument).not.toHaveBeenCalled();
      });

      it('should bind the download button in DOM to onDownload and disable it while downloading', () => {
        component.currentUserRole = 'ADMIN';
        mockDocumentService.documents.set([...mockDocuments]);
        fixture.detectChanges();

        const onDownloadSpy = vi.spyOn(component, 'onDownload');
        const downloadBtn = fixture.nativeElement.querySelector(
          '#btn-download-' + mockDocuments[0].id,
        ) as HTMLButtonElement;

        expect(downloadBtn).not.toBeNull();
        expect(downloadBtn.disabled).toBe(false);

        downloadBtn.click();
        expect(onDownloadSpy).toHaveBeenCalledWith(mockDocuments[0]);

        component.downloadingDocId = mockDocuments[0].id;
        fixture.detectChanges();
        expect(downloadBtn.disabled).toBe(true);
      });
    });

    describe('Edit Document Modal & Admin Role (SCRUM-22)', () => {
      it('should correctly identify admin users with isAdmin', () => {
        component.currentUserRole = 'ADMIN';
        expect(component.isAdmin).toBe(true);

        component.currentUserRole = 'EDITOR';
        expect(component.isAdmin).toBe(false);

        component.currentUserRole = 'VIEWER';
        expect(component.isAdmin).toBe(false);

        component.currentUserRole = null;
        expect(component.isAdmin).toBe(false);
      });

      it('should render the edit button in DOM when user is ADMIN', () => {
        component.currentUserRole = 'ADMIN';
        mockDocumentService.documents.set([...mockDocuments]);
        fixture.detectChanges();

        const editBtn = fixture.nativeElement.querySelector('#btn-edit-' + mockDocuments[0].id);
        expect(editBtn).not.toBeNull();
      });

      it('should not render the edit button in DOM when user is not ADMIN', () => {
        component.currentUserRole = 'EDITOR';
        mockDocumentService.documents.set([...mockDocuments]);
        fixture.detectChanges();

        const editBtn = fixture.nativeElement.querySelector('#btn-edit-' + mockDocuments[0].id);
        expect(editBtn).toBeNull();
      });

      it('should open edit modal and patch form values including process_area', () => {
        const docWithArea: Document = {
          ...mockDocuments[0],
          process_area: 'quimica_clinica',
        };

        component.openEditDocumentModal(docWithArea);

        expect(component.isEditModalVisible).toBe(true);
        expect(component.editingDocument).toBe(docWithArea);
        expect(component.editDocumentForm.value).toEqual({
          title: docWithArea.title,
          code: docWithArea.code,
          process_area: 'quimica_clinica',
        });
      });

      it('should close edit modal and reset form on closeEditDocumentModal', () => {
        component.openEditDocumentModal(mockDocuments[0]);
        expect(component.isEditModalVisible).toBe(true);

        component.closeEditDocumentModal();
        expect(component.isEditModalVisible).toBe(false);
        expect(component.editingDocument).toBeNull();
      });

      it('should validate required fields in editDocumentForm', () => {
        component.openEditDocumentModal(mockDocuments[0]);

        component.editDocumentForm.patchValue({
          title: '',
          process_area: '',
        });

        expect(component.editDocumentForm.invalid).toBe(true);
        expect(component.editDocumentForm.controls.title.errors?.['required']).toBe(true);
        expect(component.editDocumentForm.controls.process_area.errors?.['required']).toBe(true);
      });

      it('should call updateDocument with patched fields on saveEditDocument', async () => {
        const docToEdit = mockDocuments[0];
        component.openEditDocumentModal(docToEdit);

        component.editDocumentForm.patchValue({
          title: 'Manual Modificado',
          code: 'SGC-MAN-002',
          process_area: 'hematologia',
        });

        await component.saveEditDocument();

        expect(mockDocumentService.updateDocument).toHaveBeenCalledWith(docToEdit.id, {
          title: 'Manual Modificado',
          code: 'SGC-MAN-002',
          process_area: 'hematologia',
        });
        expect(component.isEditModalVisible).toBe(false);
        expect(mockMessageService.add).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'success',
            summary: 'Documento actualizado',
          }),
        );
        expect(mockDocumentService.loadDocuments).toHaveBeenCalled();
      });
    });

    describe('Master Document List Export', () => {
      it('should display subtitle inside table card and remove it from page header', () => {
        const cardTitle = fixture.nativeElement.querySelector('.doc-list-table-card h2');
        const headerSubtitle = fixture.nativeElement.querySelector('.doc-list-header__subtitle');

        expect(cardTitle).not.toBeNull();
        expect(cardTitle.textContent).toContain(
          'Listado Maestro de Documentos del Sistema de Gestión de Calidad',
        );
        expect(headerSubtitle).toBeNull();
      });

      it('should render the download icon button and initialize popup menu items', () => {
        const btnExportMenu = fixture.nativeElement.querySelector(
          '#btn-export-menu',
        ) as HTMLButtonElement;

        expect(btnExportMenu).not.toBeNull();
        expect(btnExportMenu.getAttribute('aria-label')).toBe('Opciones de exportación');
        expect(btnExportMenu.querySelector('.pi-download')).not.toBeNull();

        expect(component.exportMenuItems.length).toBe(2);
        expect(component.exportMenuItems[0].label).toBe('Exportar a PDF');
        expect(component.exportMenuItems[0].icon).toBe('pi pi-file-pdf');
        expect(component.exportMenuItems[1].label).toBe('Exportar a Excel');
        expect(component.exportMenuItems[1].icon).toBe('pi pi-file-excel');
      });

      it('should call exportPdf when PDF menu item command is triggered', () => {
        const exportPdfSpy = vi.spyOn(component, 'exportPdf').mockImplementation(() => undefined);

        component.exportMenuItems[0].command?.({
          originalEvent: new Event('click'),
          item: component.exportMenuItems[0],
        });

        expect(exportPdfSpy).toHaveBeenCalled();
      });

      it('should call exportExcel when Excel menu item command is triggered', () => {
        const exportExcelSpy = vi.spyOn(component, 'exportExcel').mockImplementation(() => undefined);

        component.exportMenuItems[1].command?.({
          originalEvent: new Event('click'),
          item: component.exportMenuItems[1],
        });

        expect(exportExcelSpy).toHaveBeenCalled();
      });

      describe('Conditional Date Formatting (getFormattedDocumentDate)', () => {
        it('should return "-" when document or date is undefined/invalid', () => {
          expect(component.getFormattedDocumentDate(null)).toBe('-');
          expect(component.getFormattedDocumentDate({ status: 'DRAFT' })).toBe('-');
          expect(
            component.getFormattedDocumentDate({ status: 'DRAFT', updated_at: 'invalid-date' }),
          ).toBe('-');
        });

        it('should format approved_at as MM/YYYY when status is APPROVED', () => {
          const doc = {
            status: 'APPROVED',
            approved_at: '2026-11-20T10:00:00Z',
            updated_at: '2026-05-10T10:00:00Z',
          };
          expect(component.getFormattedDocumentDate(doc)).toBe('11/2026');
        });

        it('should support approvedAt (camelCase) when status is APPROVED', () => {
          const doc = {
            status: 'APPROVED',
            approvedAt: '2026-08-15T10:00:00Z',
          };
          expect(component.getFormattedDocumentDate(doc)).toBe('08/2026');
        });

        it('should fallback to updated_at / updatedAt when status is APPROVED but no approval date exists', () => {
          const docSnake = {
            status: 'APPROVED',
            updated_at: '2026-03-12T10:00:00Z',
          };
          expect(component.getFormattedDocumentDate(docSnake)).toBe('03/2026');

          const docCamel = {
            status: 'APPROVED',
            updatedAt: '2026-04-12T10:00:00Z',
          };
          expect(component.getFormattedDocumentDate(docCamel)).toBe('04/2026');
        });

        it('should use updated_at / updatedAt when status is not APPROVED', () => {
          const docDraft = {
            status: 'DRAFT',
            updated_at: '2026-02-14T10:00:00Z',
            approved_at: '2026-12-01T10:00:00Z',
          };
          expect(component.getFormattedDocumentDate(docDraft)).toBe('02/2026');

          const docReviewed = {
            status: 'REVIEWED',
            updatedAt: '2026-07-25T10:00:00Z',
          };
          expect(component.getFormattedDocumentDate(docReviewed)).toBe('07/2026');
        });
      });

      it('should include "Fecha" column in table header and display formatted date in table body', () => {
        fixture.detectChanges();
        const thElements = Array.from(
          fixture.nativeElement.querySelectorAll('th'),
        ) as HTMLElement[];
        const dateHeader = thElements.find((th) => th.textContent?.includes('Fecha'));
        expect(dateHeader).not.toBeUndefined();
        expect(dateHeader?.textContent).not.toContain('Fecha de Modificación');

        const firstDoc = mockDocuments[0];
        const expectedDate = component.getFormattedDocumentDate(firstDoc);
        const tdCells = Array.from(
          fixture.nativeElement.querySelectorAll('tbody tr:first-child td'),
        ) as HTMLElement[];
        const matchingCell = tdCells.find((td) => td.textContent?.trim() === expectedDate);
        expect(matchingCell).not.toBeUndefined();
      });

      it('should execute exportPdf including "Fecha" in table header and body', () => {
        mockSavePdf.mockClear();
        mockAutoTable.mockClear();

        component.exportPdf();

        expect(mockAutoTable).toHaveBeenCalled();
        const callArgs = mockAutoTable.mock.calls[0][1];
        expect(callArgs.head[0]).toEqual([
          'Código',
          'Título',
          'Área / Proceso',
          'Versión',
          'Estado',
          'Fecha',
        ]);
        expect(callArgs.body[0]).toHaveLength(6);
        expect(callArgs.body[0][5]).toBe(component.getFormattedDocumentDate(mockDocuments[0]));
        expect(mockSavePdf).toHaveBeenCalledWith('listado_maestro_sgc.pdf');
      });

      it('should execute exportExcel including "Fecha" property in exported data', () => {
        mockSaveAs.mockClear();
        const jsonToSheetSpy = vi.spyOn(XLSX.utils, 'json_to_sheet');

        component.exportExcel();

        expect(jsonToSheetSpy).toHaveBeenCalled();
        const exportedRows = jsonToSheetSpy.mock.calls[0][0] as Record<string, string>[];
        expect(exportedRows[0]).toHaveProperty('Fecha');
        expect(exportedRows[0]['Fecha']).toBe(
          component.getFormattedDocumentDate(mockDocuments[0]),
        );
        expect(mockSaveAs).toHaveBeenCalledWith(
          expect.any(Blob),
          'listado_maestro_sgc.xlsx',
        );
      });
    });

    describe('Google Drive Backup Status & Manual Retry', () => {
      it('should render "Respaldo" column header immediately before "Acciones" and use colspan 7 on empty table', () => {
        mockDocumentService.documents.set([]);
        fixture.detectChanges();

        const headers = Array.from(
          fixture.nativeElement.querySelectorAll('th'),
        ) as HTMLElement[];
        const headerTexts = headers.map((th) => th.textContent?.trim() ?? '');
        const backupIndex = headerTexts.indexOf('Respaldo');
        const actionsIndex = headerTexts.indexOf('Acciones');

        expect(backupIndex).toBeGreaterThan(-1);
        expect(actionsIndex).toBe(backupIndex + 1);

        const emptyCell = fixture.nativeElement.querySelector('.doc-list-empty') as HTMLElement | null;
        expect(emptyCell?.getAttribute('colspan')).toBe('7');
      });

      it('should display a muted dash for DRAFT and REVIEWED documents', () => {
        mockDocumentService.documents.set([
          { ...mockDocuments[0], id: 'doc-draft', status: 'DRAFT' },
          { ...mockDocuments[0], id: 'doc-rev', status: 'REVIEWED' },
        ]);
        fixture.detectChanges();

        const dashes = fixture.nativeElement.querySelectorAll('.col-backup .drive-sync-dash');
        expect(dashes.length).toBe(2);
        expect(dashes[0].textContent?.trim()).toBe('—');
        expect(dashes[1].textContent?.trim()).toBe('—');
      });

      it('should render green Drive pill link when APPROVED document is SYNCED with drive_file_id', () => {
        mockDocumentService.documents.set([
          {
            ...mockDocuments[0],
            id: 'doc-synced',
            status: 'APPROVED',
            drive_sync_status: 'SYNCED',
            drive_file_id: 'drive-file-abc',
            drive_synced_at: '2026-11-20T15:30:00',
          },
        ]);
        fixture.detectChanges();

        const link = fixture.nativeElement.querySelector(
          '#link-drive-doc-synced',
        ) as HTMLAnchorElement | null;
        expect(link).toBeTruthy();
        expect(link?.classList.contains('drive-pill--synced')).toBe(true);
        expect(link?.getAttribute('href')).toBe(
          'https://drive.google.com/file/d/drive-file-abc/view',
        );
        expect(link?.getAttribute('target')).toBe('_blank');
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(link?.querySelector('.pi-cloud')).toBeTruthy();
        expect(link?.textContent?.trim()).toContain('Respaldado');
        expect(component.getDriveSyncedTooltip(mockDocumentService.documents()[0])).toBe(
          'Respaldado el 20/11/2026 15:30',
        );
      });

      it('should render non-link synced pill when drive_file_id is null', () => {
        mockDocumentService.documents.set([
          {
            ...mockDocuments[0],
            id: 'doc-synced-noid',
            status: 'APPROVED',
            drive_sync_status: 'SYNCED',
            drive_file_id: null,
            drive_synced_at: null,
          },
        ]);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#link-drive-doc-synced-noid')).toBeNull();
        const indicator = fixture.nativeElement.querySelector('#status-drive-synced-doc-synced-noid');
        expect(indicator).toBeTruthy();
        expect(indicator?.classList.contains('drive-pill--synced')).toBe(true);
        expect(indicator?.querySelector('.pi-cloud')).toBeTruthy();
        expect(indicator?.textContent?.trim()).toContain('Respaldado');
        expect(component.getDriveSyncedTooltip(mockDocumentService.documents()[0])).toBe(
          'Respaldado en Google Drive',
        );
      });

      it('should render amber pill when APPROVED document is PENDING', () => {
        mockDocumentService.documents.set([
          {
            ...mockDocuments[0],
            id: 'doc-pending',
            status: 'APPROVED',
            drive_sync_status: 'PENDING',
          },
        ]);
        fixture.detectChanges();

        const indicator = fixture.nativeElement.querySelector('#status-drive-pending-doc-pending');
        expect(indicator).toBeTruthy();
        expect(indicator?.classList.contains('drive-pill--pending')).toBe(true);
        expect(indicator?.querySelector('.pi-spin.pi-spinner')).toBeTruthy();
        expect(indicator?.textContent?.trim()).toContain('Sincronizando');
      });

      it('should render error pill and retry button for ADMIN/APPROVER when ERROR, hiding button for VIEWER', async () => {
        await fixture.whenStable();
        const errorDoc: Document = {
          ...mockDocuments[0],
          id: 'doc-err',
          status: 'APPROVED',
          drive_sync_status: 'ERROR',
          drive_sync_error: 'No se encontró la carpeta destino configurada en Google Drive.',
        };
        mockDocumentService.documents.set([errorDoc]);
        component.currentUserRole = 'APPROVER';
        fixture.detectChanges();

        const errIndicator = fixture.nativeElement.querySelector('#status-drive-error-doc-err');
        const retryBtn = fixture.nativeElement.querySelector('#btn-retry-drive-doc-err');
        expect(errIndicator?.classList.contains('drive-pill--error')).toBe(true);
        expect(errIndicator?.querySelector('.pi-exclamation-circle')).toBeTruthy();
        expect(errIndicator?.textContent?.trim()).toContain('Error');
        expect(retryBtn).toBeTruthy();
        expect(retryBtn?.classList.contains('drive-retry-btn')).toBe(true);
        expect(retryBtn?.querySelector('.pi-refresh')).toBeTruthy();

        expect(component.getDriveErrorTooltip(errorDoc)).toBe(
          'No se encontró la carpeta destino configurada en Google Drive.',
        );
        expect(
          component.getDriveErrorTooltip({
            ...errorDoc,
            drive_sync_error:
              'Google Drive upload failed: Service Accounts do not have storage quota (https://developers.google.com/drive)',
          }),
        ).toBe('Error al sincronizar con Google Drive. Hacé clic en reintentar.');
        expect(
          component.getDriveErrorTooltip({ ...errorDoc, drive_sync_error: 'Drive quota exceeded' }),
        ).toBe('Error al sincronizar con Google Drive. Hacé clic en reintentar.');
        expect(
          component.getDriveErrorTooltip({ ...errorDoc, drive_sync_error: null }),
        ).toBe('Error al sincronizar con Google Drive. Hacé clic en reintentar.');

        component.currentUserRole = 'VIEWER';
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#btn-retry-drive-doc-err')).toBeNull();
      });

      it('should render manual send button when APPROVED document has null drive_sync_status for ADMIN/APPROVER', async () => {
        await fixture.whenStable();
        mockDocumentService.documents.set([
          {
            ...mockDocuments[0],
            id: 'doc-null',
            status: 'APPROVED',
            drive_sync_status: null,
          },
        ]);
        component.currentUserRole = 'ADMIN';
        fixture.detectChanges();

        const sendBtn = fixture.nativeElement.querySelector('#btn-send-drive-doc-null');
        expect(sendBtn).toBeTruthy();
        expect(sendBtn?.classList.contains('drive-send-btn')).toBe(true);
        expect(sendBtn?.querySelector('.pi-cloud-upload')).toBeTruthy();

        component.currentUserRole = 'VIEWER';
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#btn-send-drive-doc-null')).toBeNull();
        expect(fixture.nativeElement.querySelector('#status-drive-none-doc-null')).toBeTruthy();
      });

      it('should invoke retryDriveSync and show info toast when clicking retry button', async () => {
        const errorDoc: Document = {
          ...mockDocuments[0],
          id: 'doc-retry',
          status: 'APPROVED',
          drive_sync_status: 'ERROR',
          drive_sync_error: 'Auth error',
        };
        mockDocumentService.documents.set([errorDoc]);
        component.currentUserRole = 'ADMIN';
        fixture.detectChanges();

        const retryBtn = fixture.nativeElement.querySelector(
          '#btn-retry-drive-doc-retry',
        ) as HTMLButtonElement;
        retryBtn.click();
        await fixture.whenStable();

        expect(mockDocumentService.retryDriveSync).toHaveBeenCalledWith('doc-retry');
        expect(mockMessageService.add).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'info',
            detail: 'Reintentando respaldo en Google Drive...',
          }),
        );

        fixture.destroy();
      });

      it('should show initial sync toast "Iniciando respaldo en Google Drive..." when triggering backup from null status', async () => {
        const unbackedDoc: Document = {
          ...mockDocuments[0],
          id: 'doc-first',
          status: 'APPROVED',
          drive_sync_status: null,
        };
        mockDocumentService.documents.set([unbackedDoc]);
        component.currentUserRole = 'ADMIN';
        fixture.detectChanges();

        await component.onRetryDriveSync(unbackedDoc);

        expect(mockDocumentService.retryDriveSync).toHaveBeenCalledWith('doc-first');
        expect(mockMessageService.add).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'info',
            summary: 'Respaldo',
            detail: 'Iniciando respaldo en Google Drive...',
          }),
        );

        fixture.destroy();
      });

      it('should show error toast and skip polling when initial sync or retry fails', async () => {
        const startPollingSpy = vi.spyOn(component, 'startDriveSyncPolling');
        const unbackedDoc: Document = {
          ...mockDocuments[0],
          id: 'doc-first-fail',
          status: 'APPROVED',
          drive_sync_status: null,
        };
        const errorDoc: Document = {
          ...mockDocuments[0],
          id: 'doc-retry-fail',
          status: 'APPROVED',
          drive_sync_status: 'ERROR',
          drive_sync_error: 'Auth error',
        };
        mockDocumentService.retryDriveSync.mockRejectedValueOnce(new Error('DB failure'));
        await component.onRetryDriveSync(unbackedDoc);

        expect(mockMessageService.add).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'error',
            detail: 'No se pudo iniciar el respaldo en Google Drive.',
          }),
        );

        mockDocumentService.retryDriveSync.mockRejectedValueOnce(new Error('DB failure'));
        await component.onRetryDriveSync(errorDoc);

        expect(mockMessageService.add).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'error',
            detail: 'No se pudo iniciar el reintento de respaldo.',
          }),
        );
        expect(startPollingSpy).not.toHaveBeenCalled();
      });

      it('should poll PENDING document every 2s, update row to SYNCED, stop polling, and show success toast', async () => {
        vi.useFakeTimers();
        try {
          const initialDoc: Document = {
            ...mockDocuments[0],
            id: 'doc-poll-sync',
            status: 'APPROVED',
            drive_sync_status: null,
          };
          mockDocumentService.documents.set([initialDoc]);
          mockDocumentService.getDriveSyncStatus
            .mockResolvedValueOnce({
              drive_sync_status: 'PENDING',
              drive_file_id: null,
              drive_sync_error: null,
              drive_synced_at: null,
            })
            .mockResolvedValueOnce({
              drive_sync_status: 'SYNCED',
              drive_file_id: 'drive-id-42',
              drive_sync_error: null,
              drive_synced_at: '2026-11-20T22:25:00Z',
            });

          await component.onRetryDriveSync(initialDoc);
          expect(mockDocumentService.getDriveSyncStatus).not.toHaveBeenCalled();

          await vi.advanceTimersByTimeAsync(2000);
          expect(mockDocumentService.getDriveSyncStatus).toHaveBeenCalledTimes(1);

          await vi.advanceTimersByTimeAsync(2000);
          expect(mockDocumentService.getDriveSyncStatus).toHaveBeenCalledTimes(2);
          expect(mockDocumentService.updateLocalDriveSyncState).toHaveBeenCalledWith(
            'doc-poll-sync',
            {
              drive_sync_status: 'SYNCED',
              drive_file_id: 'drive-id-42',
              drive_sync_error: null,
              drive_synced_at: '2026-11-20T22:25:00Z',
            },
          );
          expect(mockDocumentService.documents()[0].drive_sync_status).toBe('SYNCED');
          expect(mockDocumentService.documents()[0].drive_file_id).toBe('drive-id-42');
          expect(mockMessageService.add).toHaveBeenCalledWith(
            expect.objectContaining({
              severity: 'success',
              summary: 'Respaldo completado',
              detail: 'El documento se respaldó correctamente en Google Drive.',
            }),
          );

          await vi.advanceTimersByTimeAsync(6000);
          expect(mockDocumentService.getDriveSyncStatus).toHaveBeenCalledTimes(2);
        } finally {
          fixture.destroy();
          vi.useRealTimers();
        }
      });

      it('should update row to ERROR and show error toast with backend detail or Spanish fallback', async () => {
        vi.useFakeTimers();
        try {
          const docWithMsg: Document = {
            ...mockDocuments[0],
            id: 'doc-err-msg',
            status: 'APPROVED',
            drive_sync_status: 'PENDING',
          };
          const docWithoutMsg: Document = {
            ...mockDocuments[0],
            id: 'doc-err-null',
            status: 'APPROVED',
            drive_sync_status: 'PENDING',
          };
          mockDocumentService.documents.set([docWithMsg, docWithoutMsg]);
          mockDocumentService.getDriveSyncStatus
            .mockResolvedValueOnce({
              drive_sync_status: 'ERROR',
              drive_file_id: null,
              drive_sync_error: 'Permisos insuficientes o cuota excedida en Google Drive.',
              drive_synced_at: null,
            })
            .mockResolvedValueOnce({
              drive_sync_status: 'ERROR',
              drive_file_id: null,
              drive_sync_error: null,
              drive_synced_at: null,
            });

          component.startDriveSyncPolling('doc-err-msg');
          component.startDriveSyncPolling('doc-err-null');

          await vi.advanceTimersByTimeAsync(2000);

          expect(mockDocumentService.documents()[0].drive_sync_status).toBe('ERROR');
          expect(mockDocumentService.documents()[1].drive_sync_status).toBe('ERROR');
          expect(mockMessageService.add).toHaveBeenCalledWith(
            expect.objectContaining({
              severity: 'error',
              summary: 'Error de respaldo',
              detail: 'Permisos insuficientes o cuota excedida en Google Drive.',
            }),
          );
          expect(mockMessageService.add).toHaveBeenCalledWith(
            expect.objectContaining({
              severity: 'error',
              summary: 'Error de respaldo',
              detail: 'No se pudo completar el respaldo en Google Drive.',
            }),
          );
        } finally {
          fixture.destroy();
          vi.useRealTimers();
        }
      });

      it('should stop polling automatically after 15 attempts when status stays PENDING', async () => {
        vi.useFakeTimers();
        try {
          mockDocumentService.getDriveSyncStatus.mockResolvedValue({
            drive_sync_status: 'PENDING',
            drive_file_id: null,
            drive_sync_error: null,
            drive_synced_at: null,
          });

          component.startDriveSyncPolling('doc-timeout');

          await vi.advanceTimersByTimeAsync(2000 * 20);

          expect(mockDocumentService.getDriveSyncStatus).toHaveBeenCalledTimes(15);
          expect(mockMessageService.add).not.toHaveBeenCalled();
        } finally {
          fixture.destroy();
          vi.useRealTimers();
        }
      });

      it('should avoid creating duplicate polling loops for the same documentId', async () => {
        vi.useFakeTimers();
        try {
          mockDocumentService.getDriveSyncStatus.mockResolvedValue({
            drive_sync_status: 'PENDING',
            drive_file_id: null,
            drive_sync_error: null,
            drive_synced_at: null,
          });

          component.startDriveSyncPolling('doc-dup');
          component.startDriveSyncPolling('doc-dup');

          await vi.advanceTimersByTimeAsync(2000);

          expect(mockDocumentService.getDriveSyncStatus).toHaveBeenCalledTimes(1);
        } finally {
          fixture.destroy();
          vi.useRealTimers();
        }
      });

      it('should clear active polling timers when component is destroyed', async () => {
        vi.useFakeTimers();
        try {
          component.startDriveSyncPolling('doc-destroy');
          fixture.destroy();

          await vi.advanceTimersByTimeAsync(10000);

          expect(mockDocumentService.getDriveSyncStatus).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it('should show initial sync toast and start polling when approving a document via saveStatus', async () => {
        vi.useFakeTimers();
        try {
          const reviewedDoc: Document = {
            ...mockDocuments[0],
            id: 'doc-rev-approve',
            status: 'REVIEWED',
            drive_sync_status: null,
          };
          mockDocumentService.documents.set([reviewedDoc]);
          mockDocumentService.loadDocuments.mockImplementationOnce(async () => {
            mockDocumentService.documents.set([
              { ...reviewedDoc, status: 'APPROVED', drive_sync_status: 'PENDING' },
            ]);
          });
          mockDocumentService.getDriveSyncStatus.mockResolvedValueOnce({
            drive_sync_status: 'SYNCED',
            drive_file_id: 'drive-approved-1',
            drive_sync_error: null,
            drive_synced_at: '2026-11-20T22:30:00Z',
          });

          component.openStatusModal(reviewedDoc);
          await component.saveStatus();

          expect(mockMessageService.add).toHaveBeenCalledWith(
            expect.objectContaining({
              severity: 'info',
              summary: 'Respaldo',
              detail: 'Iniciando respaldo en Google Drive...',
            }),
          );

          await vi.advanceTimersByTimeAsync(2000);

          expect(mockDocumentService.getDriveSyncStatus).toHaveBeenCalledWith('doc-rev-approve');
          expect(mockMessageService.add).toHaveBeenCalledWith(
            expect.objectContaining({
              severity: 'success',
              summary: 'Respaldo completado',
              detail: 'El documento se respaldó correctamente en Google Drive.',
            }),
          );
        } finally {
          fixture.destroy();
          vi.useRealTimers();
        }
      });
    });
  });
});
