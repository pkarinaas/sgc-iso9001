import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonDirective } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { Tooltip } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import { AuthService } from '../../core/services/auth.service';
import { DocumentService } from '../../core/services/document.service';
import { DashboardService } from '../../core/services/dashboard.service';
import type { Document } from '../../core/models/document.model';
import type { User } from '../../core/models/user.model';

/**
 * DashboardComponent displays pending mandatory reading documents for the
 * currently authenticated user based on their assigned processes.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  providers: [MessageService],
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonDirective,
    Checkbox,
    CardModule,
    TagModule,
    DialogModule,
    Tooltip,
    ToastModule,
    NgxExtendedPdfViewerModule,
  ],
})
export class DashboardComponent implements OnInit {
  readonly authService = inject(AuthService);
  readonly documentService = inject(DocumentService);
  readonly dashboardService = inject(DashboardService);
  readonly messageService = inject(MessageService);
  readonly cdr = inject(ChangeDetectorRef);

  /** Profile of the currently authenticated user. */
  readonly currentUser = signal<User | null>(null);

  /** List of approved documents pending mandatory reading acknowledgement. */
  pendingDocuments: Document[] = [];

  /** Loading state indicator. */
  readonly isLoading = signal<boolean>(false);

  /** Promise tracking the pending documents load operation. */
  initPromise?: Promise<void>;

  // PDF viewer modal state

  /** Controls the visibility of the PDF viewer modal. */
  isPdfViewerVisible = false;

  /** True while the temporary signed URL is being generated. */
  isLoadingPdf = false;

  /** ID of the document currently loading its PDF. */
  loadingPdfId: number | string | null = null;

  /** Signed URL of the PDF document currently loaded in the viewer. */
  currentPdfUrl: string | null = null;

  /** Flag determining whether the mandatory reading acknowledgement UI is shown. */
  @Input() requiresAcknowledgement = false;

  /** Checkbox state for acknowledging mandatory document reading. */
  acknowledgementChecked = false;

  /** Emitted when the user confirms mandatory reading acknowledgement. */
  @Output() readonly acknowledge = new EventEmitter<void>();

  /** Shortcuts to ignore in ngx-extended-pdf-viewer to prevent download/print. */
  readonly pdfViewerIgnoreKeys: string[] = [
    'ctrl+s',
    'cmd+s',
    'meta+s',
    'ctrl+p',
    'cmd+p',
    'meta+p',
  ];

  ngOnInit(): void {
    this.initPromise = this.loadPendingDocuments();
  }

  /**
   * Fetches the current user profile and pending reading documents.
   */
  async loadPendingDocuments(): Promise<void> {
    this.isLoading.set(true);
    try {
      const user = await this.authService.getCurrentUserProfile();
      this.currentUser.set(user);
      if (user?.id && user.assigned_processes?.length) {
        this.pendingDocuments = await this.documentService.getPendingDocuments(
          user.id,
          user.assigned_processes,
        );
      } else {
        this.pendingDocuments = [];
      }
    } catch (error) {
      console.error('Error loading pending reading documents:', error);
      this.pendingDocuments = [];
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Formats a version number or string to match the repository standard, e.g. 'v00', 'v01'.
   *
   * @param version - The version string or number.
   * @returns Formatted version string.
   */
  formatVersion(version: number | string | null | undefined): string {
    if (version === null || version === undefined) {
      return 'v00';
    }
    if (typeof version === 'string') {
      return version.startsWith('v') ? version : `v${version}`;
    }
    return typeof version === 'number' && !Number.isInteger(version)
      ? `v${version.toFixed(1)}`
      : `v${String(version).padStart(2, '0')}`;
  }

  /**
   * Opens the PDF viewer modal for the given document by retrieving
   * a temporary signed URL from Supabase Storage.
   *
   * @param doc - The document to view.
   * @param requiresAcknowledgement - Whether mandatory reading acknowledgement is required.
   */
  async openReader(doc: Document, requiresAcknowledgement = true): Promise<void> {
    if (this.isLoadingPdf || !doc.file_url) {
      if (!doc.file_url) {
        this.messageService.add({
          severity: 'warn',
          summary: 'Advertencia',
          detail: 'El documento no tiene un archivo PDF asociado.',
          life: 4000,
        });
      }
      return;
    }

    this.requiresAcknowledgement = requiresAcknowledgement;
    this.acknowledgementChecked = false;
    this.isLoadingPdf = true;
    this.loadingPdfId = doc.id;
    this.cdr.markForCheck();

    try {
      const signedUrl = await this.documentService.getSignedDocumentUrl(doc.file_url);
      if (signedUrl) {
        this.currentPdfUrl = signedUrl;
        this.isPdfViewerVisible = true;
        this.cdr.detectChanges();
      } else {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Error al cargar el documento seguro.',
          life: 5000,
        });
      }
    } catch (error) {
      console.error('Error opening document viewer:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Error al cargar el documento seguro.',
        life: 5000,
      });
    } finally {
      this.isLoadingPdf = false;
      this.loadingPdfId = null;
      this.cdr.markForCheck();
    }
  }

  /**
   * Confirms mandatory reading acknowledgement for the active document.
   * Emits the acknowledge event and closes the PDF viewer modal.
   */
  confirmAcknowledgement(): void {
    if (!this.acknowledgementChecked) {
      return;
    }
    this.acknowledge.emit();
    this.closePdfViewer();
  }

  /**
   * Closes the PDF viewer modal and resets the URL and acknowledgement state.
   */
  closePdfViewer(): void {
    this.isPdfViewerVisible = false;
    this.currentPdfUrl = null;
    this.acknowledgementChecked = false;
    this.requiresAcknowledgement = false;
    this.cdr.markForCheck();
  }

  // Security event listeners for ISO 9001 compliance

  /**
   * Intercepts and blocks the context menu (right-click) exclusively while
   * the PDF viewer modal is open to comply with ISO 9001 security requirements.
   *
   * @param event - The native mouse event.
   */
  @HostListener('window:contextmenu', ['$event'])
  @HostListener('document:contextmenu', ['$event'])
  onWindowContextMenu(event: MouseEvent): void {
    if (this.isPdfViewerVisible) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
  }

  /**
   * Intercepts and blocks print (Ctrl+P / Cmd+P) and save (Ctrl+S / Cmd+S)
   * shortcuts exclusively while the PDF viewer modal is open.
   *
   * @param event - The native keyboard event.
   */
  @HostListener('window:keydown', ['$event'])
  @HostListener('document:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent): void {
    if (this.isPdfViewerVisible) {
      const key = event.key?.toLowerCase();
      const isShortcut =
        (event.ctrlKey || event.metaKey) &&
        (key === 'p' || key === 's' || event.code === 'KeyP' || event.code === 'KeyS');

      if (isShortcut) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }
    }
  }
}
