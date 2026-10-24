import { Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FilterService } from 'primeng/api';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonDirective } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DatePicker } from 'primeng/datepicker';
import { Select } from 'primeng/select';
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
    TableModule,
    TagModule,
    ButtonDirective,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    DatePicker,
    Select,
  ],
})
export class DocumentListComponent implements OnInit {
  readonly documentService = inject(DocumentService);
  private readonly filterService = inject(FilterService);

  /** Reference to the p-table instance for programmatic filter resets. */
  @ViewChild('dt') documentsTable!: Table;

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
   * Formats a version number as a version string prefixed with 'v'.
   * For example, `1` becomes `'v1.0'`.
   *
   * @param version - The numeric version from the database.
   * @returns A formatted version string, e.g. 'v1.0'.
   */
  formatVersion(version: number): string {
    return `v${version.toFixed(1)}`;
  }
}
