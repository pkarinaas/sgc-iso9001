import { Component, EventEmitter, inject, Input, OnChanges, Output, signal, SimpleChanges } from '@angular/core';
import { ButtonDirective } from 'primeng/button';
import { Drawer } from 'primeng/drawer';
import { AuditReportService, type AuditLogEntry } from '../../../core/services/audit-report.service';
import type { Document } from '../../../core/models/document.model';
import {
  formatAuditActor,
  formatAuditDetail,
  formatAuditTimestamp,
  getAuditActionPresentation,
  type AuditActionPresentation,
} from '../../../core/utils/audit-format.util';

/**
 * Side drawer component displaying the read-only chronological ISO 9001
 * traceability timeline for a selected document.
 */
@Component({
  selector: 'app-document-history-drawer',
  standalone: true,
  imports: [Drawer, ButtonDirective],
  templateUrl: './document-history-drawer.component.html',
  styleUrl: './document-history-drawer.component.css',
})
export class DocumentHistoryDrawerComponent implements OnChanges {
  private readonly auditReportService = inject(AuditReportService);

  /** Controls whether the traceability drawer is open. */
  @Input() visible = false;

  /** Document whose traceability history is being inspected. */
  @Input() document: Document | null = null;

  /** Emits updated visibility state for two-way binding. */
  @Output() readonly visibleChange = new EventEmitter<boolean>();

  /** Chronological list of audit events (newest first). */
  readonly entries = signal<AuditLogEntry[]>([]);

  /** Loading state indicator while querying history. */
  readonly loading = signal<boolean>(false);

  /** Error message shown when loading fails. */
  readonly error = signal<string | null>(null);

  /** Guards against stale async responses across rapid document switches. */
  private activeRequestId = 0;

  ngOnChanges(changes: SimpleChanges): void {
    const visibilityChanged = Boolean(changes['visible']);
    const documentChanged = Boolean(changes['document']);

    if ((visibilityChanged || documentChanged) && this.visible && this.document?.id) {
      void this.loadHistory();
    } else if (visibilityChanged && !this.visible) {
      this.activeRequestId += 1;
      this.loading.set(false);
    }
  }

  /**
   * Fetches chronological audit logs for the active document from `AuditReportService`.
   */
  async loadHistory(): Promise<void> {
    if (!this.document?.id) {
      this.entries.set([]);
      return;
    }

    const requestId = ++this.activeRequestId;
    this.entries.set([]);
    this.loading.set(true);
    this.error.set(null);

    try {
      const history = await this.auditReportService.getDocumentHistory(this.document.id);
      if (requestId === this.activeRequestId) {
        this.entries.set(history);
      }
    } catch (err: unknown) {
      if (requestId === this.activeRequestId) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'No se pudo cargar el historial de trazabilidad.';
        this.error.set(message);
        this.entries.set([]);
      }
    } finally {
      if (requestId === this.activeRequestId) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Propagates PrimeNG Drawer visibility changes to the parent component.
   */
  onVisibleChange(nextVisible: boolean): void {
    this.visibleChange.emit(nextVisible);
  }

  /** Returns the pastel marker icon and badge styling metadata for an action. */
  getPresentation(action: string): AuditActionPresentation {
    return getAuditActionPresentation(action);
  }

  /** Returns the formatted Spanish detail text for a timeline entry. */
  getDetail(entry: AuditLogEntry): string {
    return formatAuditDetail(entry);
  }

  /** Returns the formatted actor display name for a timeline entry. */
  getActor(entry: AuditLogEntry): string {
    return formatAuditActor(entry);
  }

  /** Formats the event timestamp as `dd/MM/yyyy HH:mm`. */
  getTimestamp(isoDate: string): string {
    return formatAuditTimestamp(isoDate);
  }
}
