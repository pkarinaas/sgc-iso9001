import { Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonDirective } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DocumentService } from '../../../core/services/document.service';
import type { DocumentStatus } from '../../../core/models/document.model';

/**
 * DocumentListComponent displays a filterable, paginated table of controlled
 * documents sourced from `public.documents` via `DocumentService`.
 *
 * Filter capabilities:
 *  - Global text search on `title` and `code`.
 */
@Component({
  selector: 'app-document-list',
  templateUrl: './document-list.html',
  styleUrl: './document-list.css',
  imports: [
    DatePipe,
    TableModule,
    TagModule,
    ButtonDirective,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
  ],
})
export class DocumentListComponent implements OnInit {
  readonly documentService = inject(DocumentService);

  /** Reference to the p-table instance for programmatic filter resets. */
  @ViewChild('documentsTable') documentsTable!: Table;

  /** Current value of the global text search input. */
  globalFilterValue = signal('');

  // Lifecycle

  async ngOnInit(): Promise<void> {
    await this.documentService.loadDocuments();
  }

  // Filter helpers

  /** Propagates the global text search value to the p-table's built-in filter. */
  onGlobalFilter(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.globalFilterValue.set(input.value);
    this.documentsTable.filterGlobal(input.value, 'contains');
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
