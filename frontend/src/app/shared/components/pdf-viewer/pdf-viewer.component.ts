import { ChangeDetectorRef, Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Checkbox } from 'primeng/checkbox';
import { ButtonDirective } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import { DocumentService } from '../../../core/services/document.service';

/**
 * Reusable PDF Viewer modal component supporting ISO 9001 mandatory reading
 * acknowledgement workflows.
 */
@Component({
  selector: 'app-pdf-viewer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    Checkbox,
    ButtonDirective,
    DialogModule,
    NgxExtendedPdfViewerModule,
  ],
  templateUrl: './pdf-viewer.component.html',
  styleUrl: './pdf-viewer.component.css',
})
export class PdfViewerComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly documentService = inject(DocumentService);
  private readonly messageService = inject(MessageService);

  /** Controls modal visibility. */
  @Input() visible = false;

  /** Signed URL of the PDF document. */
  @Input() src: string | null = null;

  /** ID of the document currently being viewed. */
  @Input() documentId?: number | string | null = null;

  /** ID of the acknowledging user. */
  @Input() userId?: string | null = null;

  /** Header title of the modal. */
  @Input() header = 'Visor de Documentos';

  /** Whether the viewer requires mandatory reading acknowledgement. */
  @Input() requiresAcknowledgement: boolean = false;

  /** Checkbox state for acknowledging document reading. */
  @Input() acknowledgementChecked: boolean = false;

  /** Emits when visibility changes (for two-way binding [(visible)]). */
  @Output() readonly visibleChange = new EventEmitter<boolean>();

  /** Emits when checkbox state changes. */
  @Output() readonly acknowledgementCheckedChange = new EventEmitter<boolean>();

  /** Emits when the user confirms mandatory reading acknowledgement. */
  @Output() readonly acknowledge = new EventEmitter<void>();

  /** Emits when the viewer modal is closed. */
  @Output() readonly closed = new EventEmitter<void>();

  /** True while the acknowledgement API call is in progress. */
  isAcknowledging = false;

  /** Shortcuts to ignore in ngx-extended-pdf-viewer to prevent download/print. */
  readonly pdfViewerIgnoreKeys: string[] = [
    'ctrl+s',
    'cmd+s',
    'meta+s',
    'ctrl+p',
    'cmd+p',
    'meta+p',
  ];

  /**
   * Opens the PDF viewer with the provided source and acknowledgement requirement.
   */
  open(
    src: string,
    requiresAcknowledgement = false,
    documentId: number | string | null = null,
    userId: string | null = null,
  ): void {
    this.src = src;
    this.requiresAcknowledgement = requiresAcknowledgement;
    this.documentId = documentId;
    this.userId = userId;
    this.acknowledgementChecked = false;
    this.acknowledgementCheckedChange.emit(false);
    this.visible = true;
    this.cdr.detectChanges();
  }

  /**
   * Confirms mandatory reading acknowledgement for the active document.
   */
  async confirmAcknowledgement(): Promise<void> {
    if (!this.acknowledgementChecked || this.isAcknowledging) {
      return;
    }

    if (this.documentId && this.userId) {
      this.isAcknowledging = true;
      this.cdr.markForCheck();

      try {
        await this.documentService.acknowledgeDocument(this.documentId, this.userId);

        this.messageService.add({
          severity: 'success',
          summary: 'Éxito',
          detail: 'Lectura confirmada correctamente',
          life: 4000,
        });

        this.acknowledge.emit();
        this.close();
      } catch (error) {
        console.error('Error confirming document acknowledgement:', error);
        const detail =
          error instanceof Error
            ? error.message
            : 'Error al confirmar la lectura del documento.';
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail,
          life: 5000,
        });
      } finally {
        this.isAcknowledging = false;
        this.cdr.markForCheck();
      }
    } else {
      this.acknowledge.emit();
      this.close();
    }
  }

  /**
   * Closes the PDF viewer modal and resets acknowledgement state.
   */
  close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
    this.acknowledgementChecked = false;
    this.acknowledgementCheckedChange.emit(false);
    this.closed.emit();
    this.cdr.markForCheck();
  }
}