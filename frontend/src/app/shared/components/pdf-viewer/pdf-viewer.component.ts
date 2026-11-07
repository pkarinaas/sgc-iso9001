import { ChangeDetectorRef, Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Checkbox } from 'primeng/checkbox';
import { ButtonDirective } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';

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

  /** Controls modal visibility. */
  @Input() visible = false;

  /** Signed URL of the PDF document. */
  @Input() src: string | null = null;

  /** Header title of the modal. */
  @Input() header = 'Visor de Documentos';

  /** Whether the viewer requires mandatory reading acknowledgement. */
  @Input() requiresAcknowledgement: boolean = false;

  /** Checkbox state for acknowledging document reading. */
  acknowledgementChecked: boolean = false;

  /** Emits when visibility changes (for two-way binding [(visible)]). */
  @Output() readonly visibleChange = new EventEmitter<boolean>();

  /** Emits when the user confirms mandatory reading acknowledgement. */
  @Output() readonly acknowledge = new EventEmitter<void>();

  /** Emits when the viewer modal is closed. */
  @Output() readonly closed = new EventEmitter<void>();

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
  open(src: string, requiresAcknowledgement = false): void {
    this.src = src;
    this.requiresAcknowledgement = requiresAcknowledgement;
    this.acknowledgementChecked = false;
    this.visible = true;
    this.cdr.detectChanges();
  }

  /**
   * Confirms mandatory reading acknowledgement for the active document.
   */
  confirmAcknowledgement(): void {
    if (!this.acknowledgementChecked) {
      return;
    }
    this.acknowledge.emit();
    this.close();
  }

  /**
   * Closes the PDF viewer modal and resets acknowledgement state.
   */
  close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
    this.acknowledgementChecked = false;
    this.closed.emit();
    this.cdr.markForCheck();
  }
}