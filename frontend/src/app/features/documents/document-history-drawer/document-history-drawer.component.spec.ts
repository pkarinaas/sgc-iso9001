import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentHistoryDrawerComponent } from './document-history-drawer.component';
import { AuditReportService, type AuditLogEntry } from '../../../core/services/audit-report.service';
import type { Document } from '../../../core/models/document.model';

describe('DocumentHistoryDrawerComponent', () => {
  let fixture: ComponentFixture<DocumentHistoryDrawerComponent>;
  let component: DocumentHistoryDrawerComponent;
  let mockAuditReportService: {
    getDocumentHistory: ReturnType<typeof vi.fn>;
  };

  const mockDocument: Document = {
    id: 'doc-101',
    code: 'POE-001',
    title: 'Procedimiento de Calidad',
    version: 1,
    status: 'APPROVED',
    process_area: 'calidad',
    file_url: 'https://storage.supabase.com/sgc-files/poe001.pdf',
    creator_id: 'usr-1',
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-20T15:30:00Z',
  };

  const sampleEntries: AuditLogEntry[] = [
    {
      id: 'log-4',
      user_id: null,
      document_id: 'doc-101',
      action: 'DRIVE_SYNC_SUCCESS',
      details: { drive_file_id: 'drive-123' },
      created_at: '2026-11-20T15:32:00',
      user_name: null,
      user_email: null,
      doc_code: 'POE-001',
      doc_title: 'Procedimiento de Calidad',
      doc_version: 1,
    },
    {
      id: 'log-3',
      user_id: 'usr-3',
      document_id: 'doc-101',
      action: 'READ_ACKNOWLEDGED',
      details: {},
      created_at: '2026-11-20T15:31:00',
      user_name: 'Juan Pérez',
      user_email: 'juan@empresa.com',
      doc_code: 'POE-001',
      doc_title: 'Procedimiento de Calidad',
      doc_version: 1,
    },
    {
      id: 'log-2',
      user_id: 'usr-2',
      document_id: 'doc-101',
      action: 'DOCUMENT_APPROVED',
      details: { old_status: 'REVIEWED', new_status: 'APPROVED' },
      created_at: '2026-11-20T15:30:00',
      user_name: 'María López',
      user_email: 'maria@empresa.com',
      doc_code: 'POE-001',
      doc_title: 'Procedimiento de Calidad',
      doc_version: 1,
    },
    {
      id: 'log-1',
      user_id: 'usr-1',
      document_id: 'doc-101',
      action: 'DOCUMENT_CREATED',
      details: { new_status: 'DRAFT', document_version: 0 },
      created_at: '2026-11-01T10:00:00',
      user_name: 'Carlos Gómez',
      user_email: 'carlos@empresa.com',
      doc_code: 'POE-001',
      doc_title: 'Procedimiento de Calidad',
      doc_version: 0,
    },
  ];

  beforeEach(async () => {
    mockAuditReportService = {
      getDocumentHistory: vi.fn().mockResolvedValue(sampleEntries),
    };

    await TestBed.configureTestingModule({
      imports: [DocumentHistoryDrawerComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AuditReportService, useValue: mockAuditReportService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentHistoryDrawerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and avoid fetching history while drawer is closed', () => {
    expect(component).toBeTruthy();
    expect(mockAuditReportService.getDocumentHistory).not.toHaveBeenCalled();
  });

  it('should load and render chronological timeline with badges, Spanish details, date, and user when opened', async () => {
    fixture.componentRef.setInput('document', mockDocument);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockAuditReportService.getDocumentHistory).toHaveBeenCalledWith('doc-101');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.history-drawer__title')?.textContent?.trim()).toBe(
      'Historial de trazabilidad',
    );
    expect(el.querySelector('.history-drawer__subtitle')?.textContent?.trim()).toBe(
      'POE-001 · Procedimiento de Calidad',
    );

    const items = el.querySelectorAll('.history-timeline__item');
    expect(items.length).toBe(4);
    expect(items[0].textContent).toContain('Respaldo Drive');
    expect(items[0].textContent).toContain('Sistema (Google Drive)');
    expect(items[0].querySelector('.timeline-variant--teal')).toBeTruthy();

    expect(items[1].textContent).toContain('Acuse de lectura');
    expect(items[1].querySelector('.timeline-variant--indigo')).toBeTruthy();

    expect(items[2].textContent).toContain('Aprobación');
    expect(items[2].textContent).toContain('Estado: Revisado → Aprobado');
    expect(items[2].textContent).toContain('20/11/2026 15:30');
    expect(items[2].textContent).toContain('María López');
    expect(items[2].querySelector('.timeline-variant--green')).toBeTruthy();

    expect(items[3].textContent).toContain('Creación');
    expect(items[3].querySelector('.timeline-variant--blue')).toBeTruthy();
  });

  it('should display empty state when document has no audit entries', async () => {
    mockAuditReportService.getDocumentHistory.mockResolvedValueOnce([]);

    fixture.componentRef.setInput('document', mockDocument);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.history-drawer__empty-text')?.textContent?.trim()).toBe(
      'No hay registros de trazabilidad para este documento.',
    );
  });

  it('should show error state and retry when loading fails', async () => {
    mockAuditReportService.getDocumentHistory
      .mockRejectedValueOnce(new Error('Error al obtener historial de trazabilidad: timeout'))
      .mockResolvedValueOnce(sampleEntries);

    fixture.componentRef.setInput('document', mockDocument);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.history-drawer__error-text')?.textContent).toContain(
      'Error al obtener historial de trazabilidad',
    );

    const retryBtn = el.querySelector('#btn-retry-history') as HTMLButtonElement;
    retryBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockAuditReportService.getDocumentHistory).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll('.history-timeline__item').length).toBe(4);
  });

  it('should emit visibleChange when visibility changes', () => {
    const emitSpy = vi.spyOn(component.visibleChange, 'emit');
    component.onVisibleChange(false);
    expect(emitSpy).toHaveBeenCalledWith(false);
  });
});
