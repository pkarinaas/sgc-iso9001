import { Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { FilterService } from 'primeng/api';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonDirective } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DatePicker } from 'primeng/datepicker';
import { Select } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { FileUpload, FileUploadModule } from 'primeng/fileupload';
import { PrimeNG } from 'primeng/config';
import { DocumentService } from '../../../core/services/document.service';
import type { DocumentStatus } from '../../../core/models/document.model';

interface DateRangeFilter {
  start: Date | null;
  end: Date | null;
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
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    TagModule,
    ButtonDirective,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    DatePicker,
    Select,
    DialogModule,
    FileUploadModule,
  ],
})
export class DocumentListComponent implements OnInit {
  readonly documentService = inject(DocumentService);
  private readonly filterService = inject(FilterService);
  private readonly fb = inject(FormBuilder);
  private readonly primeNG = inject(PrimeNG);

  /** Reference to the p-table instance for programmatic filter resets. */
  @ViewChild('dt') documentsTable!: Table;

  /** Reference to the file upload component to reset its file state. */
  @ViewChild('fileUpload') fileUpload?: FileUpload;

  // Dialog state

  /** Controls the visibility of the upload document dialog modal. */
  isDialogVisible = false;

  /** True while the upload/save operation is in-flight. */
  isSubmitting = false;

  // Reactive form for uploading new document

  readonly documentForm = this.fb.group({
    title: ['', [Validators.required]],
    code: [''],
    version: ['00', [Validators.required, Validators.pattern(/^[0-9]+$/)]],
    file: [null as File | null, [Validators.required]],
  });

  /** Current value of the global text search input. */
  globalFilterValue = signal('');

  /** Options for the status filter dropdown. */
  readonly statusOptions: { label: string; value: DocumentStatus | null }[] = [
    { label: 'Todos los estados', value: null },
    { label: 'Borrador', value: 'DRAFT' },
    { label: 'Aprobado', value: 'APPROVED' },
    { label: 'Obsoleto', value: 'OBSOLETE' },
  ];

  /** Date range filter values. */
  startDate: Date | null = null;
  endDate: Date | null = null;
  readonly datePickerInputStyle = { height: '42px' };

  // Lifecycle

  async ngOnInit(): Promise<void> {
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
    });
    await this.documentService.loadDocuments();
  }

  // Filter helpers

  /** Propagates the global text search value to the p-table's built-in filter. */
  onGlobalFilter(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.globalFilterValue.set(input.value);
    this.documentsTable.filterGlobal(input.value, 'contains');
  }

  /** Handles changes to the status filter dropdown. */
  onStatusChange(event: { value: DocumentStatus | null }, dt: Table): void {
    dt.filter(event.value, 'status', 'equals');
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

  // Dialog & File upload methods

  /**
   * Opens the upload document modal dialog after resetting the form.
   */
  openUploadDialog(): void {
    this.documentForm.reset({
      title: '',
      code: '',
      version: '00',
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
  onFileSelect(event: any): void {
    const file =
      event?.files?.[0] ?? event?.currentFiles?.[0] ?? (event instanceof File ? event : null);

    if (file) {
      this.documentForm.patchValue({ file });
      this.documentForm.get('file')?.markAsDirty();
      this.documentForm.get('file')?.updateValueAndValidity();
    }
  }

  /**
   * Handles document form submission.
   */
  saveDocument(): void {
    if (this.documentForm.invalid || this.isSubmitting) {
      this.documentForm.markAllAsTouched();
      return;
    }
  }
}
