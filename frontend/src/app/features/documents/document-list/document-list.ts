import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import {
  MessageService,
  FilterService,
  ConfirmationService,
  SharedModule,
  MenuItem,
} from 'primeng/api';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonDirective } from 'primeng/button';
import { Ripple } from 'primeng/ripple';
import { MenuModule } from 'primeng/menu';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DatePicker } from 'primeng/datepicker';
import { Select } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { FileUpload, FileUploadModule } from 'primeng/fileupload';
import { PrimeNG } from 'primeng/config';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Tooltip } from 'primeng/tooltip';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { AuthService } from '../../../core/services/auth.service';
import { DocumentService } from '../../../core/services/document.service';
import { DocumentHistoryDrawerComponent } from '../document-history-drawer/document-history-drawer.component';
import type {
  Document,
  DocumentStatus,
  DriveSyncSnapshot,
} from '../../../core/models/document.model';
import { PROCESS_AREAS } from '../../../core/constants/process-area.constant';

interface DateRangeFilter {
  start: Date | null;
  end: Date | null;
}

export interface DocumentDateSource {
  status?: DocumentStatus | string | null;
  approved_at?: string | Date | null;
  approvedAt?: string | Date | null;
  updated_at?: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface FileSelectionEvent {
  files?: File[] | FileList;
  currentFiles?: File[];
}

/**
 * DocumentListComponent displays a filterable, paginated table of controlled
 * documents sourced from `public.documents` via `DocumentService`.
 *
 * Filter capabilities:
 *  - Global text search on `title` and `code`.
 *  - Status dropdown filter.
 *  - Start and end date filters on `updated_at`.
 */
@Component({
  selector: 'app-document-list',
  templateUrl: './document-list.html',
  styleUrl: './document-list.css',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    TagModule,
    ButtonDirective,
    Ripple,
    MenuModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    DatePicker,
    Select,
    DialogModule,
    FileUploadModule,
    ToastModule,
    ConfirmDialog,
    Tooltip,
    SharedModule,
    NgxExtendedPdfViewerModule,
    DocumentHistoryDrawerComponent,
  ],
  providers: [MessageService, ConfirmationService],
})
export class DocumentListComponent implements OnInit {
  readonly authService = inject(AuthService);
  readonly documentService = inject(DocumentService);

  private readonly _currentUserRole = signal<string | null>(null);

  /** Current role of the authenticated user (e.g. 'ADMIN', 'EDITOR', 'REVIEWER', 'APPROVER', 'VIEWER'). */
  get currentUserRole(): string | null {
    return this._currentUserRole();
  }

  set currentUserRole(value: string | null) {
    this._currentUserRole.set(value);
  }
  private readonly filterService = inject(FilterService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly fb = inject(FormBuilder);
  private readonly primeNG = inject(PrimeNG);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Polling interval (ms) for checking asynchronous Google Drive backup status. */
  static readonly DRIVE_SYNC_POLL_INTERVAL_MS = 2000;

  /** Maximum number of polling attempts per document (15 * 2s = 30s). */
  static readonly DRIVE_SYNC_POLL_MAX_ATTEMPTS = 15;

  /** Active per-document polling timers keyed by stringified document ID. */
  private readonly activeDriveSyncPollers = new Map<
    string,
    ReturnType<typeof setTimeout> | null
  >();

  /** Set to true once the component is destroyed so async callbacks exit safely. */
  private isDestroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.isDestroyed = true;
      this.clearAllDriveSyncPollers();
    });
  }

  /** Reference to the p-table instance for programmatic filter resets. */
  @ViewChild('dt') documentsTable!: Table;

  /** Reference to the file upload component to reset its file state. */
  @ViewChild('fileUpload') fileUpload?: FileUpload;

  /** Reference to the status filter p-select component. */
  @ViewChild('statusSelect') statusSelect?: Select;

  // Dialog state

  /** Controls the visibility of the upload document dialog modal. */
  isDialogVisible = false;

  /** True while the upload/save operation is in-flight. */
  isSubmitting = false;

  // Edit document dialog state

  /** Controls the visibility of the edit document dialog modal. */
  isEditModalVisible = false;

  /** Alias getter/setter for compatibility. */
  get isEditDocumentModalVisible(): boolean {
    return this.isEditModalVisible;
  }
  set isEditDocumentModalVisible(value: boolean) {
    this.isEditModalVisible = value;
  }

  /** True while the edit document operation is in-flight. */
  isSubmittingEdit = false;

  /** Document currently selected for editing. */
  editingDocument: Document | null = null;

  // PDF viewer modal state

  /** Controls the visibility of the PDF viewer dialog modal. */
  isPdfViewerVisible = false;

  /** True while the temporary signed URL is being generated. */
  isLoadingPdf = false;

  /** ID of the document currently loading its PDF signed URL. */
  loadingPdfId: number | string | null = null;

  /** ID of the document currently being watermarked and downloaded. */
  downloadingDocId: number | string | null = null;

  /** URL of the PDF document currently loaded in the viewer. */
  currentPdfUrl: string | null = null;

  /** Shortcuts to ignore in ngx-extended-pdf-viewer to prevent download/print. */
  readonly pdfViewerIgnoreKeys: string[] = [
    'ctrl+s',
    'cmd+s',
    'meta+s',
    'ctrl+p',
    'cmd+p',
    'meta+p',
  ];

  // Status change modal state

  /** Controls the visibility of the change status dialog modal. */
  isStatusModalVisible = false;

  /** Document currently selected for status update. */
  documentToChange: Document | null = null;

  /** New status selected in the dropdown. */
  selectedNewStatus: DocumentStatus | null = null;

  /** Available lifecycle state transitions for the selected document. */
  availableStates: { label: string; value: DocumentStatus }[] = [];

  /** True while the status update request is in-flight. */
  isUpdatingStatus = false;

  /** Allowed status transitions according to ISO 9001 workflow. */
  readonly allowedTransitions: Record<DocumentStatus, { label: string; value: DocumentStatus }[]> =
    {
      DRAFT: [{ label: 'Revisado', value: 'REVIEWED' }],
      REVIEWED: [
        { label: 'Aprobado', value: 'APPROVED' },
        { label: 'Borrador', value: 'DRAFT' },
      ],
      APPROVED: [{ label: 'Obsoleto', value: 'OBSOLETE' }],
      OBSOLETE: [],
    };

  // Form constants

  /** Maximum allowed PDF file size in bytes (5 MB). */
  static readonly MAX_FILE_SIZE_BYTES = 5_242_880;

  /** Available process/area options for document categorization. */
  readonly processAreaOptions = PROCESS_AREAS;

  // Reactive form for uploading new document

  readonly documentForm = this.fb.group({
    title: ['', [Validators.required]],
    code: [''],
    process_area: ['', [Validators.required]],
    file: [null as File | null, [Validators.required, DocumentListComponent.fileSizeValidator]],
  });

  // Reactive form for editing existing document metadata

  readonly editDocumentForm = this.fb.group({
    title: ['', [Validators.required]],
    code: [''],
    process_area: ['', [Validators.required]],
  });

  /**
   * Synchronous validator that rejects files exceeding `MAX_FILE_SIZE_BYTES`.
   *
   * @param control - The reactive form control holding the `File` object.
   * @returns `{ maxSize: { actual: number; max: number } }` when the file is too large, or `null`.
   */
  static fileSizeValidator(control: AbstractControl): ValidationErrors | null {
    const file = control.value as File | null;
    if (!file || !(file instanceof File)) return null;
    return file.size > DocumentListComponent.MAX_FILE_SIZE_BYTES
      ? { maxSize: { actual: file.size, max: DocumentListComponent.MAX_FILE_SIZE_BYTES } }
      : null;
  }

  /** Current value of the global text search input. */
  globalFilterValue = signal('');

  private readonly _selectedStatus = signal<DocumentStatus | null>(null);

  /** Currently selected status filter option (null = show all except OBSOLETE). */
  get selectedStatus(): DocumentStatus | null {
    return this._selectedStatus();
  }

  set selectedStatus(value: DocumentStatus | null) {
    this._selectedStatus.set(value);
  }

  private readonly _displayedDocuments = computed(() => {
    const all = this.documentService.documents();
    const status = this._selectedStatus();
    if (status === 'OBSOLETE') {
      return all;
    }
    return all.filter((doc) => doc.status !== 'OBSOLETE');
  });

  /**
   * Computed list of documents to display in the table.
   * By default ('Todos los estados' or null), documents with status 'OBSOLETE' are hidden.
   * Obsolete documents are only displayed if the user explicitly selects 'OBSOLETE' from the status dropdown filter.
   */
  get displayedDocuments(): Document[] {
    return this._displayedDocuments();
  }

  /** Options for the status filter dropdown. */
  readonly statusOptions: { label: string; value: DocumentStatus | null }[] = [
    { label: 'Todos los estados', value: null },
    { label: 'Borrador', value: 'DRAFT' },
    { label: 'Revisado', value: 'REVIEWED' },
    { label: 'Aprobado', value: 'APPROVED' },
    { label: 'Obsoleto', value: 'OBSOLETE' },
  ];

  /** Date range filter values. */
  startDate: Date | null = null;
  endDate: Date | null = null;
  readonly datePickerInputStyle = { height: '42px' };

  /** Menu items for the export dropdown popup menu. */
  exportMenuItems: MenuItem[] = [];

  // Lifecycle

  async ngOnInit(): Promise<void> {
    this.exportMenuItems = [
      { label: 'Exportar a PDF', icon: 'pi pi-file-pdf', command: () => this.exportPdf() },
      { label: 'Exportar a Excel', icon: 'pi pi-file-excel', command: () => this.exportExcel() },
    ];
    this.filterService.register(
      'dateRangeCustom',
      (value: string | Date | null | undefined, filter: DateRangeFilter | null): boolean => {
        if (!filter || (!filter.start && !filter.end)) return true;
        if (!value) return false;

        const rowDate = new Date(value);
        if (Number.isNaN(rowDate.getTime())) return false;
        rowDate.setHours(0, 0, 0, 0);

        if (filter.start) {
          const start = new Date(filter.start);
          start.setHours(0, 0, 0, 0);
          if (rowDate < start) return false;
        }

        if (filter.end) {
          const end = new Date(filter.end);
          end.setHours(23, 59, 59, 999);
          if (rowDate > end) return false;
        }

        return true;
      },
    );
    this.primeNG.setTranslation({
      noFileChosenMessage: 'Ningún archivo seleccionado',
      fileChosenMessage: '{0} archivos seleccionados',
      fileSizeTypes: ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
    });
    this.currentUserRole = await this.authService.getUserRole();
    await this.documentService.loadDocuments();
    this.resumePendingDriveSyncPolling();
  }

  // Filter helpers

  /** Propagates the global text search value to the p-table's built-in filter. */
  onGlobalFilter(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.globalFilterValue.set(input.value);
    this.documentsTable.filterGlobal(input.value, 'contains');
  }

  /** Handles changes to the status filter dropdown and ensures the dropdown closes. */
  onStatusChange(event: { value: DocumentStatus | null }, dt: Table, statusSelect?: Select): void {
    this.selectedStatus = event.value;
    dt.filter(event.value, 'status', 'equals');
    (statusSelect ?? this.statusSelect)?.hide();
  }

  /** Handles changes to the date range filters. */
  onDateFilterChange(dt: Table): void {
    dt.filter({ start: this.startDate, end: this.endDate }, 'updated_at', 'dateRangeCustom');
  }

  // Display helpers

  /**
   * Maps database status codes to their Spanish UI labels.
   *
   * @param status - The raw status value from the database.
   * @returns A Spanish label.
   */
  getStatusLabel(status: DocumentStatus | string): string {
    const labels: Record<string, string> = {
      DRAFT: 'Borrador',
      REVIEWED: 'Revisado',
      APPROVED: 'Aprobado',
      OBSOLETE: 'Obsoleto',
    };
    return labels[status] ?? status;
  }

  /**
   * Formats a version number or string prefixed with 'v'.
   * For example, `'00'` becomes `'v00'`, `1` becomes `'v01'`.
   *
   * @param version - The version string or number.
   * @returns A formatted version string, e.g. 'v00', 'v01'.
   */
  formatVersion(version: number | string): string {
    if (typeof version === 'string') {
      return version.startsWith('v') ? version : `v${version}`;
    }
    return typeof version === 'number' && !Number.isInteger(version)
      ? `v${version.toFixed(1)}`
      : `v${String(version).padStart(2, '0')}`;
  }

  /**
   * Formats a process area identifier into its human-readable label.
   *
   * @param area - Key or name of the process area.
   * @returns Formatted label.
   */
  getProcessAreaLabel(area: string | null | undefined): string {
    if (!area) return 'N/A';
    const found = this.processAreaOptions.find((p) => p.value === area);
    return found ? found.label : area;
  }

  /**
   * Formats the relevant document date according to ISO 9001 requirements.
   * - If status is 'APPROVED', returns the Approval Date (e.g. approved_at / approvedAt or fallback).
   * - Otherwise, returns the Last Modification Date (updated_at / updatedAt).
   * Format: MM/YYYY (e.g. '11/2026').
   *
   * @param doc - The document object.
   * @returns Formatted date string in 'MM/YYYY' format or '-' if date is unavailable.
   */
  getFormattedDocumentDate(doc: DocumentDateSource | null | undefined): string {
    if (!doc) return '-';
    const rawDate =
      doc.status === 'APPROVED'
        ? (doc.approved_at ?? doc.approvedAt ?? doc.updated_at ?? doc.updatedAt)
        : (doc.updated_at ?? doc.updatedAt);

    if (!rawDate) return '-';
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return '-';

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${year}`;
  }

  /**
   * Retrieves the current document set displayed in the table (filtered or full list).
   *
   * @returns Array of documents to export.
   */
  getDocumentsToExport(): Document[] {
    return this.documentsTable?.filteredValue ?? this.displayedDocuments;
  }

  /**
   * Exports the currently displayed document list into a PDF document using jsPDF and jspdf-autotable.
   */
  exportPdf(): void {
    const docs = this.getDocumentsToExport();
    const doc = new jsPDF();

    // Header title and metadata
    doc.setFontSize(16);
    doc.setTextColor(136, 19, 55); // #881337
    doc.text('Listado Maestro de Documentos - SGC', 14, 18);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Fecha de exportación: ${new Date().toLocaleDateString('es-ES')}`, 14, 25);
    doc.text(`Total de documentos: ${docs.length}`, 14, 30);

    const head = [['Código', 'Título', 'Área / Proceso', 'Versión', 'Estado', 'Fecha']];
    const body = docs.map((d) => [
      d.code || 'S/C',
      d.title || '',
      this.getProcessAreaLabel(d.process_area),
      this.formatVersion(d.version),
      this.getStatusLabel(d.status),
      this.getFormattedDocumentDate(d),
    ]);

    autoTable(doc, {
      head,
      body,
      startY: 35,
      styles: {
        fontSize: 8,
        cellPadding: 3,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [136, 19, 55],
        textColor: 255,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
    });

    doc.save('listado_maestro_sgc.pdf');
  }

  /**
   * Exports the currently displayed document list into an Excel workbook (.xlsx) using xlsx and file-saver.
   */
  exportExcel(): void {
    const docs = this.getDocumentsToExport();
    const data = docs.map((d) => ({
      'Código': d.code || 'S/C',
      'Título': d.title || '',
      'Área / Proceso': this.getProcessAreaLabel(d.process_area),
      'Versión': this.formatVersion(d.version),
      'Estado': this.getStatusLabel(d.status),
      'Fecha': this.getFormattedDocumentDate(d),
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Listado Maestro');

    const excelBuffer: ArrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8',
    });
    saveAs(blob, 'listado_maestro_sgc.xlsx');
  }

  // PDF viewer modal methods

  /**
   * Opens the PDF viewer dialog modal for the given document by retrieving
   * a temporary signed URL from Supabase storage.
   *
   * @param doc - The document whose PDF is to be viewed.
   */
  async openPdfViewer(doc: Document): Promise<void> {
    if (this.isLoadingPdf || !doc.file_url) {
      return;
    }

    this.isLoadingPdf = true;
    this.loadingPdfId = doc.id;
    this.cdr.markForCheck();

    try {
      const signedUrl = await this.documentService.getSignedDocumentUrl(doc.file_url);

      if (!signedUrl) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Error al cargar el documento seguro',
          life: 5000,
        });
        return;
      }

      // Close other modals defensively so only the PDF viewer is displayed
      this.isStatusModalVisible = false;
      this.isDialogVisible = false;

      this.currentPdfUrl = signedUrl;
      this.isPdfViewerVisible = true;
      this.cdr.detectChanges();
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Error al cargar el documento seguro',
        life: 5000,
      });
    } finally {
      this.isLoadingPdf = false;
      this.loadingPdfId = null;
      this.cdr.markForCheck();
    }
  }

  /**
   * Closes the PDF viewer dialog modal and resets the URL.
   */
  closePdfViewer(): void {
    this.isPdfViewerVisible = false;
    this.currentPdfUrl = null;
    this.cdr.markForCheck();
  }

  // PDF Viewer security event listeners

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
        (key === 'p' ||
          key === 's' ||
          event.code === 'KeyP' ||
          event.code === 'KeyS' ||
          event.keyCode === 80 ||
          event.keyCode === 83);

      if (isShortcut) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }
    }
  }

  // Document download with watermark

  /**
   * Intercepts the download action, stamps an indelible "COPIA NO CONTROLADA"
   * watermark with the current date across all pages via DocumentService,
   * and triggers the browser download of the watermarked file.
   *
   * @param doc - The document to download.
   */
  async onDownload(doc: Document): Promise<void> {
    if (this.downloadingDocId === doc.id || !doc.file_url) {
      return;
    }

    this.downloadingDocId = doc.id;
    this.cdr.markForCheck();

    this.messageService.add({
      severity: 'info',
      summary: 'Descarga',
      detail: 'Preparando documento seguro...',
      life: 3000,
    });

    try {
      await this.documentService.downloadWatermarkedDocument(doc.file_url, doc.code, doc.title);

      this.messageService.add({
        severity: 'success',
        summary: 'Éxito',
        detail: 'Documento descargado con marca de agua.',
        life: 4000,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error al generar la descarga del documento.';
      this.messageService.add({
        severity: 'error',
        summary: 'Error al descargar',
        detail: this.formatErrorMessage(message),
        life: 5000,
      });
    } finally {
      this.downloadingDocId = null;
      this.cdr.markForCheck();
    }
  }

  // Dialog & File upload methods

  /**
   * Opens the upload document modal dialog after resetting the form.
   */
  openUploadDialog(): void {
    this.documentForm.reset({
      title: '',
      code: '',
      process_area: '',
      file: null,
    });
    this.fileUpload?.clear();
    this.isDialogVisible = true;
  }

  /**
   * Closes the upload document modal dialog.
   */
  closeUploadDialog(): void {
    this.isDialogVisible = false;
  }

  /**
   * Captures the selected file from the PrimeNG FileUpload component
   * and assigns it to the `file` form control.
   *
   * @param event - The selection event emitted by p-fileupload.
   */
  onFileSelect(event: FileSelectionEvent | File | null | undefined): void {
    const file =
      event instanceof File
        ? event
        : (event?.files?.[0] ?? event?.currentFiles?.[0] ?? null);

    if (file) {
      this.documentForm.patchValue({ file });
      this.documentForm.get('file')?.markAsDirty();
      this.documentForm.get('file')?.updateValueAndValidity();
    }
  }

  /**
   * Handles document form submission: uploads the PDF to Storage and saves
   * the metadata to the database via `DocumentService.createDocument()`.
   *
   * On success, shows a toast notification, closes the modal, resets the form,
   * and refreshes the documents table.
   * On failure, shows an error toast with the underlying message.
   */
  async saveDocument(): Promise<void> {
    if (this.documentForm.invalid || this.isSubmitting) {
      this.documentForm.markAllAsTouched();
      return;
    }

    const { file, title, code, process_area } = this.documentForm.value;

    this.isSubmitting = true;
    try {
      await this.documentService.createDocument(file!, {
        title: title!,
        code: code ?? '',
        process_area: process_area ?? '',
      });

      this.messageService.add({
        severity: 'success',
        summary: 'Documento guardado',
        detail: 'El documento se subió correctamente.',
        life: 4000,
      });

      this.isDialogVisible = false;
      this.documentForm.reset({ title: '', code: '', process_area: '', file: null });
      this.fileUpload?.clear();
      await this.documentService.loadDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al guardar el documento.';
      this.messageService.add({
        severity: 'error',
        summary: 'Error al guardar',
        detail: this.formatErrorMessage(message),
        life: 6000,
      });
    } finally {
      this.isSubmitting = false;
    }
  }

  // Edit document methods

  /**
   * Opens the edit document modal dialog pre-populated with the selected document's data.
   *
   * @param doc - The document to edit.
   */
  openEditDocumentModal(doc: Document): void {
    this.editingDocument = doc;
    this.editDocumentForm.reset();
    this.editDocumentForm.patchValue({
      title: doc.title,
      code: doc.code ?? '',
      process_area: doc.process_area ?? '',
    });
    this.isEditModalVisible = true;
  }

  /**
   * Closes the edit document modal dialog and resets state.
   */
  closeEditDocumentModal(): void {
    this.isEditModalVisible = false;
    this.editingDocument = null;
    this.editDocumentForm.reset();
  }

  /**
   * Submits the updated document metadata to Supabase via `DocumentService.updateDocument()`.
   */
  async saveEditDocument(): Promise<void> {
    if (this.editDocumentForm.invalid || this.isSubmittingEdit) {
      this.editDocumentForm.markAllAsTouched();
      return;
    }

    if (!this.editingDocument) {
      return;
    }

    const { title, code, process_area } = this.editDocumentForm.value;
    this.isSubmittingEdit = true;

    try {
      await this.documentService.updateDocument(this.editingDocument.id, {
        title: title!,
        code: code ?? '',
        process_area: process_area ?? '',
      });

      this.messageService.add({
        severity: 'success',
        summary: 'Documento actualizado',
        detail: 'El documento se actualizó correctamente.',
        life: 4000,
      });

      this.isEditModalVisible = false;
      this.editingDocument = null;
      this.editDocumentForm.reset();
      await this.documentService.loadDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al actualizar el documento.';
      this.messageService.add({
        severity: 'error',
        summary: 'Error al actualizar',
        detail: this.formatErrorMessage(message),
        life: 6000,
      });
    } finally {
      this.isSubmittingEdit = false;
    }
  }

  // Status modal methods

  /**
   * Opens the change status dialog modal for a selected document,
   * filtering available states based on current document status.
   *
   * @param doc - The document whose status is to be modified.
   */
  openStatusModal(doc: Document): void {
    // Ensure PDF viewer modal is not concurrently visible
    this.isPdfViewerVisible = false;
    this.documentToChange = doc;
    this.availableStates = this.allowedTransitions[doc.status] ?? [];
    this.selectedNewStatus = this.availableStates.length > 0 ? this.availableStates[0].value : null;
    this.isStatusModalVisible = true;
    this.cdr.markForCheck();
  }

  /**
   * Closes the change status dialog modal and resets transient state.
   */
  closeStatusModal(): void {
    this.isStatusModalVisible = false;
    this.documentToChange = null;
    this.selectedNewStatus = null;
    this.availableStates = [];
  }

  /**
   * Saves the newly selected status via DocumentService.
   * Shows a success toast, refreshes the document repository, and closes the modal.
   */
  async saveStatus(): Promise<void> {
    if (!this.documentToChange || !this.selectedNewStatus || this.isUpdatingStatus) {
      return;
    }

    const targetDocumentId = this.documentToChange.id;
    const targetStatus = this.selectedNewStatus;

    this.isUpdatingStatus = true;
    try {
      await this.documentService.updateDocumentStatus(targetDocumentId, targetStatus);

      this.messageService.add({
        severity: 'success',
        summary: 'Éxito',
        detail: 'Estado actualizado',
        life: 4000,
      });

      this.closeStatusModal();
      await this.documentService.loadDocuments();

      if (targetStatus === 'APPROVED') {
        const refreshedDoc = this.documentService
          .documents()
          .find((doc) => String(doc.id) === String(targetDocumentId));

        if (refreshedDoc?.drive_sync_status === 'SYNCED') {
          this.messageService.add({
            severity: 'success',
            summary: 'Respaldo completado',
            detail: 'El documento se respaldó correctamente en Google Drive.',
            life: 5000,
          });
        } else if (refreshedDoc?.drive_sync_status === 'ERROR') {
          this.messageService.add({
            severity: 'error',
            summary: 'Error de respaldo',
            detail: this.getDriveErrorToastDetail(refreshedDoc.drive_sync_error),
            life: 6000,
          });
        } else {
          this.messageService.add({
            severity: 'info',
            summary: 'Respaldo',
            detail: 'Iniciando respaldo en Google Drive...',
            life: 4000,
          });
          this.startDriveSyncPolling(targetDocumentId);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error al actualizar el estado del documento.';
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: this.formatErrorMessage(message),
        life: 6000,
      });
    } finally {
      this.isUpdatingStatus = false;
    }
  }

  // Role-based action helpers

  /**
   * Indicates whether the currently authenticated user has the 'ADMIN' role.
   */
  get isAdmin(): boolean {
    return this.currentUserRole === 'ADMIN';
  }

  /**
   * Determines whether management actions should be visible for the given role.
   * Returns false if the role is 'VIEWER'.
   *
   * @param role - Optional role to check (defaults to current user's role).
   * @returns `false` if role is 'VIEWER', otherwise `true`.
   */
  canViewActions(role: string = this.currentUserRole ?? ''): boolean {
    const activeRole = role || (this.currentUserRole ?? '');
    return activeRole !== 'VIEWER';
  }

  /** Controls visibility of the per-document ISO 9001 traceability drawer. */
  isHistoryDrawerVisible = false;

  /** Document currently displayed inside the traceability drawer. */
  selectedHistoryDocument: Document | null = null;

  /**
   * Determines whether the given role can view document traceability history.
   * Matches RLS `audit_logs_select_policy` ('ADMIN' and 'APPROVER').
   */
  canViewAuditHistory(role: string = this.currentUserRole ?? ''): boolean {
    const activeRole = role || (this.currentUserRole ?? '');
    return activeRole === 'ADMIN' || activeRole === 'APPROVER';
  }

  /** Opens the traceability history drawer for the selected document. */
  openHistoryDrawer(doc: Document): void {
    this.selectedHistoryDocument = doc;
    this.isHistoryDrawerVisible = true;
    this.cdr.markForCheck();
  }

  /** Syncs drawer visibility state and clears the active document when closed. */
  onHistoryDrawerVisibleChange(visible: boolean): void {
    this.isHistoryDrawerVisible = visible;
    if (!visible) {
      this.selectedHistoryDocument = null;
    }
    this.cdr.markForCheck();
  }

  /**
   * Determines whether the given document can be deleted.
   * Business rule: only 'DRAFT' and 'REVIEWED' documents can be deleted,
   * and users with 'VIEWER' role cannot delete any document.
   *
   * @param doc - The document to evaluate.
   * @param role - Optional role to evaluate against (defaults to current user's role).
   * @returns `true` if the document is in 'DRAFT' or 'REVIEWED' state and role is not 'VIEWER', otherwise `false`.
   */
  canDelete(doc: Document, role: string = this.currentUserRole ?? ''): boolean {
    const activeRole = role || (this.currentUserRole ?? '');
    if (activeRole === 'VIEWER') {
      return false;
    }
    return doc.status === 'DRAFT' || doc.status === 'REVIEWED';
  }

  /**
   * Determines whether the user has permissions to transition a document's status.
   *
   * Role-based permissions matching Supabase RLS:
   *  - 'ADMIN': Can transition 'DRAFT', 'REVIEWED', 'APPROVED'.
   *  - 'EDITOR': Can only transition 'DRAFT'.
   *  - 'REVIEWER': Can transition 'DRAFT' or 'REVIEWED'.
   *  - 'APPROVER': Can transition 'REVIEWED' or 'APPROVED'.
   *  - 'VIEWER': Cannot transition any document.
   *  - 'OBSOLETE' documents cannot transition in any role.
   *
   * @param doc - The document to evaluate.
   * @param role - Optional role to evaluate against (defaults to current user's role).
   * @returns `true` if the status change action is allowed for the user's role, `false` otherwise.
   */
  canChangeStatus(doc: Document, role: string = this.currentUserRole ?? ''): boolean {
    const activeRole = role || (this.currentUserRole ?? '');
    if (!activeRole || activeRole === 'VIEWER' || doc.status === 'OBSOLETE') {
      return false;
    }

    switch (activeRole) {
      case 'ADMIN':
        return true;
      case 'EDITOR':
        return doc.status === 'DRAFT';
      case 'REVIEWER':
        return doc.status === 'DRAFT' || doc.status === 'REVIEWED';
      case 'APPROVER':
        return doc.status === 'REVIEWED' || doc.status === 'APPROVED';
      default:
        return false;
    }
  }

  // Google Drive backup status & retry helpers

  /**
   * Determines whether the given role can trigger a manual Google Drive sync retry
   * on approved documents (matching Supabase RLS `documents_update_policy`).
   *
   * @param role - Optional role to evaluate (defaults to current user's role).
   * @returns `true` for 'ADMIN' and 'APPROVER', `false` otherwise.
   */
  canRetryDriveSync(role: string = this.currentUserRole ?? ''): boolean {
    const activeRole = role || (this.currentUserRole ?? '');
    return activeRole === 'ADMIN' || activeRole === 'APPROVER';
  }

  /**
   * Formats an ISO timestamp into `dd/MM/yyyy HH:mm` for Google Drive backup tooltips.
   *
   * @param isoDate - The ISO timestamp from `drive_synced_at`.
   * @returns Formatted date/time string or empty string if missing/invalid.
   */
  formatDriveSyncedDate(isoDate: string | null | undefined): string {
    if (!isoDate) {
      return '';
    }
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  /**
   * Builds the tooltip shown when a document is synced to Google Drive.
   *
   * @param doc - The synced document record.
   * @returns Localized Spanish tooltip including sync timestamp if available.
   */
  getDriveSyncedTooltip(doc: Document): string {
    const formatted = this.formatDriveSyncedDate(doc.drive_synced_at);
    return formatted ? `Respaldado el ${formatted}` : 'Respaldado en Google Drive';
  }

  /**
   * Builds the tooltip shown when Google Drive synchronization failed.
   * Falls back to a concise Spanish message if `drive_sync_error` is missing
   * or still holds a legacy raw English/URL technical error.
   *
   * @param doc - The document record in error state.
   * @returns Localized Spanish error tooltip.
   */
  getDriveErrorTooltip(doc: Document): string {
    const fallbackMessage = 'Error al sincronizar con Google Drive. Hacé clic en reintentar.';
    const rawError = doc.drive_sync_error?.trim();
    if (!rawError || this.isLegacyTechnicalDriveError(rawError)) {
      return fallbackMessage;
    }
    return rawError;
  }

  /**
   * Detects legacy raw English technical errors or URLs stored before Spanish mapping.
   */
  private isLegacyTechnicalDriveError(message: string): boolean {
    if (message.length > 160 || /https?:\/\/|\berror:/i.test(message)) {
      return true;
    }
    return /\b(failed|quota|exceeded|storage|service account|oauth|token|invalid|missing|unexpected|unable|timeout|network|forbidden|unauthorized|not found|http\s*\d{3}|google drive upload|supabase|status code|exception|stack|permission denied)\b/i.test(
      message,
    );
  }

  /**
   * Builds the external Google Drive viewer URL for a backed-up document.
   *
   * @param fileId - The Google Drive file ID.
   * @returns Direct Google Drive file URL.
   */
  getDriveFileUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  }

  /**
   * Triggers a manual Google Drive backup or retry for the specified document,
   * displays context-specific PrimeNG Toast feedback, and starts status polling.
   *
   * @param doc - The approved document to sync.
   */
  async onRetryDriveSync(doc: Document): Promise<void> {
    if (!this.canRetryDriveSync() || doc.drive_sync_status === 'PENDING') {
      return;
    }

    const isRetry = doc.drive_sync_status === 'ERROR';

    try {
      await this.documentService.retryDriveSync(doc.id);
      this.messageService.add({
        severity: 'info',
        summary: 'Respaldo',
        detail: isRetry
          ? 'Reintentando respaldo en Google Drive...'
          : 'Iniciando respaldo en Google Drive...',
        life: 4000,
      });
      this.startDriveSyncPolling(doc.id);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: isRetry
          ? 'No se pudo iniciar el reintento de respaldo.'
          : 'No se pudo iniciar el respaldo en Google Drive.',
        life: 6000,
      });
    } finally {
      this.cdr.markForCheck();
    }
  }

  /**
   * Starts bounded polling for any approved document already in `'PENDING'` sync state
   * when the repository initially loads.
   */
  private resumePendingDriveSyncPolling(): void {
    for (const doc of this.documentService.documents()) {
      if (doc.status === 'APPROVED' && doc.drive_sync_status === 'PENDING') {
        this.startDriveSyncPolling(doc.id);
      }
    }
  }

  /**
   * Polls `public.documents` every 2 seconds (up to 15 attempts / 30 seconds) for a document
   * in `'PENDING'` Drive sync state, updating the row and displaying a completion Toast
   * as soon as the state transitions out of `'PENDING'`.
   *
   * Deduplicates active pollers per `documentId` and exits safely on component destroy.
   *
   * @param documentId - The ID of the document to monitor.
   */
  startDriveSyncPolling(documentId: number | string): void {
    const key = String(documentId);
    if (this.isDestroyed || this.activeDriveSyncPollers.has(key)) {
      return;
    }

    let attempts = 0;

    const scheduleNext = (): void => {
      if (this.isDestroyed || !this.activeDriveSyncPollers.has(key)) {
        return;
      }
      const timerId = setTimeout(() => {
        void runCheck();
      }, DocumentListComponent.DRIVE_SYNC_POLL_INTERVAL_MS);
      this.activeDriveSyncPollers.set(key, timerId);
    };

    const runCheck = async (): Promise<void> => {
      if (this.isDestroyed || !this.activeDriveSyncPollers.has(key)) {
        return;
      }

      this.activeDriveSyncPollers.set(key, null);
      attempts += 1;

      let snapshot: DriveSyncSnapshot | null = null;
      try {
        snapshot = await this.documentService.getDriveSyncStatus(documentId);
      } catch (err) {
        console.error('Unexpected error polling Google Drive sync status:', err);
      }

      if (this.isDestroyed || !this.activeDriveSyncPollers.has(key)) {
        return;
      }

      if (snapshot && snapshot.drive_sync_status !== 'PENDING') {
        this.stopDriveSyncPolling(documentId);
        this.documentService.updateLocalDriveSyncState(documentId, snapshot);

        if (snapshot.drive_sync_status === 'SYNCED') {
          this.messageService.add({
            severity: 'success',
            summary: 'Respaldo completado',
            detail: 'El documento se respaldó correctamente en Google Drive.',
            life: 5000,
          });
        } else if (snapshot.drive_sync_status === 'ERROR') {
          this.messageService.add({
            severity: 'error',
            summary: 'Error de respaldo',
            detail: this.getDriveErrorToastDetail(snapshot.drive_sync_error),
            life: 6000,
          });
        }

        this.cdr.markForCheck();
        return;
      }

      if (attempts >= DocumentListComponent.DRIVE_SYNC_POLL_MAX_ATTEMPTS) {
        this.stopDriveSyncPolling(documentId);
        return;
      }

      scheduleNext();
    };

    this.activeDriveSyncPollers.set(key, null);
    scheduleNext();
  }

  /**
   * Stops an active Google Drive polling loop for the given document ID, if present.
   *
   * @param documentId - The ID of the document whose poller should be cleared.
   */
  stopDriveSyncPolling(documentId: number | string): void {
    const key = String(documentId);
    const timerId = this.activeDriveSyncPollers.get(key);
    if (timerId !== null && timerId !== undefined) {
      clearTimeout(timerId);
    }
    this.activeDriveSyncPollers.delete(key);
  }

  /**
   * Clears all active Google Drive sync polling timers on component destruction.
   */
  private clearAllDriveSyncPollers(): void {
    for (const timerId of this.activeDriveSyncPollers.values()) {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    }
    this.activeDriveSyncPollers.clear();
  }

  /**
   * Builds a clean Spanish error Toast detail from `drive_sync_error`, falling back
   * if missing or if it contains legacy raw technical text/URLs.
   */
  private getDriveErrorToastDetail(driveSyncError: string | null | undefined): string {
    const trimmed = driveSyncError?.trim();
    if (!trimmed || this.isLegacyTechnicalDriveError(trimmed)) {
      return 'No se pudo completar el respaldo en Google Drive.';
    }
    return trimmed;
  }

  /**
   * Displays a confirmation dialog before deleting a document.
   * If accepted, calls `DocumentService.deleteDocument()`, shows a success toast,
   * and refreshes the document repository list.
   *
   * @param doc - The document to be deleted.
   */
  confirmDelete(doc: Document): void {
    this.confirmationService.confirm({
      header: 'Confirmar Eliminación',
      message: '¿Estás seguro de que deseas eliminar este documento?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, eliminar',
      rejectLabel: 'Cancelar',
      rejectButtonProps: {
        severity: 'secondary',
        text: true,
      },
      acceptButtonProps: {
        severity: 'primary',
      },
      rejectButtonStyleClass: 'btn-confirm-cancel',
      acceptButtonStyleClass: 'btn-confirm-accept',
      accept: async () => {
        try {
          await this.documentService.deleteDocument(doc.id);
          this.messageService.add({
            severity: 'success',
            summary: 'Éxito',
            detail: 'Documento eliminado correctamente',
            life: 4000,
          });
          await this.documentService.loadDocuments();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Error al eliminar el documento.';
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: this.formatErrorMessage(message),
            life: 6000,
          });
        }
      },
    });
  }

  /**
   * Formats error messages ensuring any technical English string is shown in Spanish.
   */
  private formatErrorMessage(message: string): string {
    const lower = message.toLowerCase();
    if (
      lower.includes('row-level security') ||
      lower.includes('violates row-level security policy')
    ) {
      return 'No tienes permisos suficientes para realizar esta acción (política de seguridad).';
    }
    if (lower.includes('failed to fetch') || lower.includes('network')) {
      return 'Error de conexión con el servidor. Verifica tu conexión a internet.';
    }
    return message;
  }
}
