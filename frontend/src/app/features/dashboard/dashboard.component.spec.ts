import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardComponent } from './dashboard.component';
import { AuthService } from '../../core/services/auth.service';
import { DocumentService } from '../../core/services/document.service';
import { DashboardService } from '../../core/services/dashboard.service';
import type { Document } from '../../core/models/document.model';
import type { User } from '../../core/models/user.model';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  const mockUser: User = {
    id: 'usr-123',
    email: 'empleado@empresa.com',
    full_name: 'Juan Pérez',
    role_id: 2,
    is_active: true,
    created_at: new Date().toISOString(),
    assigned_processes: ['quimica_clinica', 'hematologia'],
  };

  const mockPendingDocs: Document[] = [
    {
      id: 'doc-1',
      code: 'SGC-PR-001',
      title: 'Procedimiento de Toma de Muestra',
      version: 1,
      status: 'APPROVED',
      process_area: 'quimica_clinica',
      file_url: 'https://storage.supabase.com/docs/pr01.pdf',
      creator_id: 'usr-admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'doc-2',
      code: 'SGC-IN-002',
      title: 'Instructivo de Frotis Sanguíneo',
      version: 2,
      status: 'APPROVED',
      process_area: 'hematologia',
      file_url: 'https://storage.supabase.com/docs/in02.pdf',
      creator_id: 'usr-admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  let mockAuthService: {
    getCurrentUserProfile: ReturnType<typeof vi.fn>;
  };

  let mockDocumentService: {
    getPendingDocuments: ReturnType<typeof vi.fn>;
    getSignedDocumentUrl: ReturnType<typeof vi.fn>;
  };

  let mockDashboardService: {
    getPendingDocuments: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockAuthService = {
      getCurrentUserProfile: vi.fn().mockResolvedValue({ ...mockUser }),
    };

    mockDocumentService = {
      getPendingDocuments: vi.fn().mockResolvedValue([...mockPendingDocs]),
      getSignedDocumentUrl: vi.fn().mockResolvedValue('https://storage.supabase.com/signed/test.pdf'),
    };

    mockDashboardService = {
      getPendingDocuments: vi.fn().mockResolvedValue([...mockPendingDocs]),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AuthService, useValue: mockAuthService },
        { provide: DocumentService, useValue: mockDocumentService },
        { provide: DashboardService, useValue: mockDashboardService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.initPromise;
    fixture.detectChanges();
  });

  it('should create the dashboard component', () => {
    expect(component).toBeTruthy();
  });

  it('should fetch user profile and pending documents on ngOnInit', () => {
    expect(mockAuthService.getCurrentUserProfile).toHaveBeenCalled();
    expect(mockDocumentService.getPendingDocuments).toHaveBeenCalledWith('usr-123', [
      'quimica_clinica',
      'hematologia',
    ]);
    expect(component.pendingDocuments).toEqual(mockPendingDocs);
    expect(component.isLoading()).toBe(false);
  });

  describe('Version formatting (Instruction 2)', () => {
    it('should format version numbers padded to two digits with v prefix', () => {
      expect(component.formatVersion(0)).toBe('v00');
      expect(component.formatVersion(1)).toBe('v01');
      expect(component.formatVersion(9)).toBe('v09');
      expect(component.formatVersion(10)).toBe('v10');
      expect(component.formatVersion(25)).toBe('v25');
      expect(component.formatVersion('v03')).toBe('v03');
      expect(component.formatVersion('3')).toBe('v3');
      expect(component.formatVersion(null)).toBe('v00');
      expect(component.formatVersion(undefined)).toBe('v00');
    });

    it('should render padded versions matching repository styling in table rows', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const versionSpans = compiled.querySelectorAll('.doc-version');
      expect(versionSpans.length).toBe(2);
      expect(versionSpans[0].textContent?.trim()).toBe('v01');
      expect(versionSpans[1].textContent?.trim()).toBe('v02');
    });
  });

  describe('Action button and PDF reader (Instructions 3 & 4)', () => {
    it('should render the view button with pi-eye icon and repository classes', () => {
      const viewBtn = fixture.nativeElement.querySelector('#btn-view-doc-1') as HTMLButtonElement;
      expect(viewBtn).not.toBeNull();
      expect(viewBtn.classList.contains('p-button-rounded')).toBe(true);
      expect(viewBtn.classList.contains('p-button-text')).toBe(true);
      expect(viewBtn.classList.contains('p-button-sm')).toBe(true);
      expect(viewBtn.classList.contains('p-button-info')).toBe(true);

      const eyeIcon = viewBtn.querySelector('.pi.pi-eye');
      expect(eyeIcon).not.toBeNull();
    });

    it('should open PDF viewer when clicking the view button', async () => {
      const viewBtn = fixture.nativeElement.querySelector('#btn-view-doc-1') as HTMLButtonElement;
      expect(viewBtn).not.toBeNull();

      await component.openReader(mockPendingDocs[0]);
      fixture.detectChanges();

      expect(mockDocumentService.getSignedDocumentUrl).toHaveBeenCalledWith(
        'https://storage.supabase.com/docs/pr01.pdf',
      );
      expect(component.isPdfViewerVisible).toBe(true);
      expect(component.currentPdfUrl).toBe('https://storage.supabase.com/signed/test.pdf');
    });

    it('should close PDF viewer and clear URL when closePdfViewer is called', async () => {
      await component.openReader(mockPendingDocs[0]);
      expect(component.isPdfViewerVisible).toBe(true);

      component.closePdfViewer();
      expect(component.isPdfViewerVisible).toBe(false);
      expect(component.currentPdfUrl).toBeNull();
    });

    it('should block context menu when PDF viewer is open (ISO 9001)', async () => {
      component.isPdfViewerVisible = true;
      const event = new MouseEvent('contextmenu', { cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      component.onWindowContextMenu(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should block Ctrl+P and Ctrl+S print/save shortcuts when PDF viewer is open', () => {
      component.isPdfViewerVisible = true;
      const printEvent = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true });
      const preventPrintSpy = vi.spyOn(printEvent, 'preventDefault');

      component.onWindowKeyDown(printEvent);
      expect(preventPrintSpy).toHaveBeenCalled();

      const saveEvent = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
      const preventSaveSpy = vi.spyOn(saveEvent, 'preventDefault');

      component.onWindowKeyDown(saveEvent);
      expect(preventSaveSpy).toHaveBeenCalled();
    });

    it('should show warning toast and not open viewer if doc has no file_url', async () => {
      const toastSpy = vi.spyOn(component.messageService, 'add');
      const docWithoutFile = { ...mockPendingDocs[0], file_url: null as unknown as string };

      await component.openReader(docWithoutFile);
      expect(component.isPdfViewerVisible).toBe(false);
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warn' }),
      );
    });

    it('should show error toast if signed url generation returns null', async () => {
      const toastSpy = vi.spyOn(component.messageService, 'add');
      mockDocumentService.getSignedDocumentUrl.mockResolvedValueOnce(null);

      await component.openReader(mockPendingDocs[0]);
      expect(component.isPdfViewerVisible).toBe(false);
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
    });
  });

  it('should display friendly empty state when there are no pending documents', async () => {
    mockDocumentService.getPendingDocuments.mockResolvedValue([]);
    await component.loadPendingDocuments();
    fixture.detectChanges();

    expect(component.pendingDocuments.length).toBe(0);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('¡Al día! No tienes documentos pendientes de lectura.');
  });

  it('should display friendly empty state if user has no assigned processes', async () => {
    mockAuthService.getCurrentUserProfile.mockResolvedValue({
      ...mockUser,
      assigned_processes: [],
    });

    await component.loadPendingDocuments();
    fixture.detectChanges();

    expect(component.pendingDocuments.length).toBe(0);
    expect(mockDocumentService.getPendingDocuments).toHaveBeenCalledTimes(1);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('¡Al día! No tienes documentos pendientes de lectura.');
  });
});
