import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageService } from 'primeng/api';
import { PdfViewerComponent } from './pdf-viewer.component';
import { DocumentService } from '../../../core/services/document.service';

describe('PdfViewerComponent', () => {
  let component: PdfViewerComponent;
  let fixture: ComponentFixture<PdfViewerComponent>;

  let mockDocumentService: {
    acknowledgeDocument: ReturnType<typeof vi.fn>;
  };

  let mockMessageService: {
    add: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockDocumentService = {
      acknowledgeDocument: vi.fn().mockResolvedValue({ id: 1 }),
    };

    mockMessageService = {
      add: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [PdfViewerComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DocumentService, useValue: mockDocumentService },
        { provide: MessageService, useValue: mockMessageService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PdfViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should have requiresAcknowledgement false by default', () => {
    expect(component.requiresAcknowledgement).toBe(false);
    expect(component.acknowledgementChecked).toBe(false);
  });

  it('should not show acknowledgement footer when requiresAcknowledgement is false', () => {
    component.open('https://storage.supabase.com/test.pdf', false);
    fixture.detectChanges();

    const ackCheck = document.body.querySelector('#ack-check');
    expect(ackCheck).toBeNull();
  });

  it('should show acknowledgement footer when requiresAcknowledgement is true', () => {
    component.open('https://storage.supabase.com/test.pdf', true);
    fixture.detectChanges();

    const ackCheck = document.body.querySelector('#ack-check');
    expect(ackCheck).not.toBeNull();
    expect(document.body.textContent).toContain(
      'Declaro haber leído y comprendido las directrices de este documento.',
    );
  });

  it('should disable confirm button when acknowledgementChecked is false', () => {
    component.open('https://storage.supabase.com/test.pdf', true);
    component.acknowledgementChecked = false;
    fixture.detectChanges();

    const confirmButton = document.body.querySelector(
      'button[label="Confirmar lectura"]',
    ) as HTMLButtonElement;
    expect(confirmButton?.disabled).toBe(true);
  });

  it('should enable confirm button and emit acknowledge on confirmAcknowledgement when checked', async () => {
    const acknowledgeSpy = vi.spyOn(component.acknowledge, 'emit');
    const closeSpy = vi.spyOn(component, 'close');

    component.acknowledgementChecked = true;
    await component.confirmAcknowledgement();

    expect(acknowledgeSpy).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
    expect(component.visible).toBe(false);
  });

  it('should not emit acknowledge if confirmAcknowledgement is called when acknowledgementChecked is false', async () => {
    const acknowledgeSpy = vi.spyOn(component.acknowledge, 'emit');

    component.acknowledgementChecked = false;
    await component.confirmAcknowledgement();

    expect(acknowledgeSpy).not.toHaveBeenCalled();
  });

  describe('Document Acknowledgement Persistence (SCRUM-60)', () => {
    it('should call documentService.acknowledgeDocument and display success toast when documentId and userId are provided', async () => {
      const acknowledgeSpy = vi.spyOn(component.acknowledge, 'emit');
      const closeSpy = vi.spyOn(component, 'close');

      component.documentId = 'doc-123';
      component.userId = 'usr-456';
      component.acknowledgementChecked = true;

      await component.confirmAcknowledgement();

      expect(mockDocumentService.acknowledgeDocument).toHaveBeenCalledWith('doc-123', 'usr-456');
      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'success',
          summary: 'Éxito',
          detail: 'Lectura confirmada correctamente',
        }),
      );
      expect(acknowledgeSpy).toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalled();
    });

    it('should display error toast when acknowledgeDocument throws an error', async () => {
      const acknowledgeSpy = vi.spyOn(component.acknowledge, 'emit');
      mockDocumentService.acknowledgeDocument.mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      component.documentId = 'doc-123';
      component.userId = 'usr-456';
      component.acknowledgementChecked = true;

      await component.confirmAcknowledgement();

      expect(mockDocumentService.acknowledgeDocument).toHaveBeenCalledWith('doc-123', 'usr-456');
      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Error',
          detail: 'Database connection failed',
        }),
      );
      expect(acknowledgeSpy).not.toHaveBeenCalled();
    });
  });
});
