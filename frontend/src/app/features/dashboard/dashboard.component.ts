import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonDirective } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ProgressBar } from 'primeng/progressbar';
import { Chart } from 'chart.js/auto';
import { PdfViewerComponent } from '../../shared/components/pdf-viewer/pdf-viewer.component';
import { AuthService } from '../../core/services/auth.service';
import { DocumentService } from '../../core/services/document.service';
import { DashboardService } from '../../core/services/dashboard.service';
import type { Document } from '../../core/models/document.model';
import type { User } from '../../core/models/user.model';
import type { DashboardMetrics, PendingDocumentDetail } from '../../core/models/dashboard.model';

/**
 * DashboardComponent displays pending mandatory reading documents for the
 * currently authenticated user based on their assigned processes.
 * For Administrator users, it also displays high-level analytics: total
 * reading acknowledgements, adherence rate, a doughnut chart of documents
 * grouped by status, and a traceability table of pending reads.
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
    CardModule,
    TagModule,
    Tooltip,
    ToastModule,
    ProgressBar,
    PdfViewerComponent,
  ],
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly authService = inject(AuthService);
  readonly documentService = inject(DocumentService);
  readonly dashboardService = inject(DashboardService);
  readonly messageService = inject(MessageService);
  readonly cdr = inject(ChangeDetectorRef);

  /** Profile of the currently authenticated user. */
  readonly currentUser = signal<User | null>(null);

  /** List of approved documents pending mandatory reading acknowledgement. */
  pendingDocuments: Document[] = [];

  /** Currently selected document for viewing or acknowledgement. */
  selectedDocument: Document | null = null;

  /** Loading state indicator. */
  readonly isLoading = signal<boolean>(false);

  /** Loading state for admin metrics. */
  readonly isLoadingMetrics = signal<boolean>(false);

  // Analytics State

  /** Canvas reference for rendering the documents by status doughnut chart. */
  @ViewChild('dashboardChart') chartRef?: ElementRef<HTMLCanvasElement>;

  /** Native Chart.js instance. */
  private chartInstance: Chart | null = null;

  /** Total count of document reading acknowledgements across the system. */
  totalAcknowledgements = 0;

  /** Total completed reading acknowledgements count. */
  totalCompleted = 0;

  /** Total required reads that haven't been completed. */
  totalPending = 0;

  /** Adherence rate percentage (0-100). */
  adherencePercentage = 0;

  /** Document details with list of pending users. */
  pendingDetails: PendingDocumentDetail[] = [];

  /** Chart.js data configuration for the documents by status chart. */
  chartData: any = null;

  /** Chart.js display options for the documents by status chart. */
  chartOptions: any = null;

  /** Promise tracking the pending documents load operation. */
  initPromise?: Promise<void>;

  /**
   * Indicates whether the currently authenticated user is an Administrator.
   * Analytics and system-wide metrics are restricted strictly to Admins.
   */
  get isAdmin(): boolean {
    const user = this.currentUser();
    const role =
      user?.roles?.name ??
      (Array.isArray(user?.roles) ? (user.roles as any)[0]?.name : null) ??
      (typeof this.authService.userRole === 'function' ? this.authService.userRole() : null);

    return role?.toUpperCase() === 'ADMIN';
  }

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

  ngAfterViewInit(): void {
    if (this.chartData && this.chartRef?.nativeElement) {
      this.initOrUpdateChart();
    }
  }

  ngOnDestroy(): void {
    this.destroyChart();
  }

  /**
   * Fetches the current user profile, pending reading documents,
   * and admin metrics (if the user is an Administrator).
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

      if (this.isAdmin) {
        await this.loadMetrics();
      }
    } catch (error) {
      console.error('Error loading pending reading documents:', error);
      this.pendingDocuments = [];
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Fetches aggregated metrics from DashboardService and maps them to Chart.js format.
   * Only relevant for Administrator users.
   */
  async loadMetrics(): Promise<void> {
    this.isLoadingMetrics.set(true);
    try {
      const metrics: DashboardMetrics = await this.dashboardService.getDashboardMetrics();
      if (metrics) {
        this.totalCompleted =
          metrics.totalCompleted ?? metrics.total_completed ?? metrics.totalAcknowledgements ?? 0;
        this.totalPending = metrics.totalPending ?? metrics.total_pending ?? 0;
        this.adherencePercentage = metrics.adherencePercentage ?? metrics.adherence_percentage ?? 0;
        this.pendingDetails = metrics.pendingDetails ?? metrics.pending_details ?? [];
        this.totalAcknowledgements = this.totalCompleted;

        const byStatus = metrics.documentsByStatus ?? metrics.documents_by_status ?? {};
        this.setupChartData(byStatus);

        this.cdr.detectChanges();
        this.initOrUpdateChart();
      }
    } catch (error) {
      console.error('Error loading dashboard metrics:', error);
    } finally {
      this.isLoadingMetrics.set(false);
      this.cdr.markForCheck();
      setTimeout(() => this.initOrUpdateChart(), 0);
    }
  }

  /**
   * Instantiates or re-renders the native Chart.js doughnut chart on the canvas element.
   */
  initOrUpdateChart(): void {
    if (!this.chartRef?.nativeElement || !this.chartData) {
      return;
    }

    this.destroyChart();

    const canvas = this.chartRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    this.chartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: this.chartData,
      options: this.chartOptions,
    });
  }

  /**
   * Destroys any existing Chart.js instance to prevent memory leaks and duplicate canvas contexts.
   */
  destroyChart(): void {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
  }

  /**
   * Formats a process area identifier into a readable Spanish label.
   *
   * @param area - Process area key.
   * @returns Formatted label.
   */
  formatProcessArea(area: string | null | undefined): string {
    if (!area) return 'General';
    const areaLabels: Record<string, string> = {
      calidad: 'Calidad',
      direccion: 'Dirección',
      quimica_clinica: 'Química Clínica',
      hematologia: 'Hematología',
      microbiologia: 'Microbiología',
      inmunologia: 'Inmunología',
      recursos_humanos: 'Recursos Humanos',
      administracion: 'Administración',
      mantenimiento: 'Mantenimiento',
      compras: 'Compras',
    };
    return (
      areaLabels[area.toLowerCase()] ||
      area.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    );
  }

  /**
   * Returns a PrimeNG tag severity corresponding to the process area.
   *
   * @param area - Process area key.
   * @returns Tag severity type.
   */
  getProcessAreaSeverity(
    area: string | null | undefined,
  ): 'info' | 'success' | 'warn' | 'secondary' {
    if (!area) return 'secondary';
    const normalized = area.toLowerCase();
    if (normalized.includes('calidad') || normalized.includes('direccion')) return 'success';
    if (normalized.includes('quimica') || normalized.includes('hematologia')) return 'info';
    return 'secondary';
  }

  /**
   * Transforms the status count dictionary into Chart.js dataset structure
   * enforcing the chronological document lifecycle order:
   * Borrador (DRAFT) -> Revisado (REVIEWED) -> Aprobado (APPROVED) -> Obsoleto (OBSOLETE).
   *
   * @param documentsByStatus - Object with status keys and document count values.
   */
  setupChartData(documentsByStatus: Record<string, number>): void {
    // Strict chronological document lifecycle order
    const orderedStatuses = ['DRAFT', 'REVIEWED', 'APPROVED', 'OBSOLETE'] as const;

    const statusLabels: Record<string, string> = {
      DRAFT: 'Borrador',
      REVIEWED: 'Revisado',
      APPROVED: 'Aprobado',
      OBSOLETE: 'Obsoleto',
    };

    const statusColors: Record<string, string> = {
      DRAFT: '#f59e0b',
      REVIEWED: '#3b82f6',
      APPROVED: '#10b981',
      OBSOLETE: '#64748b',
    };

    const labels = orderedStatuses.map((status) => statusLabels[status]);
    const data = orderedStatuses.map((status) => documentsByStatus[status] ?? 0);
    const backgroundColor = orderedStatuses.map((status) => statusColors[status]);

    this.chartData = {
      labels,
      datasets: [
        {
          data,
          backgroundColor,
          hoverBackgroundColor: backgroundColor,
        },
      ],
    };

    this.chartOptions = {
      plugins: {
        legend: {
          labels: {
            usePointStyle: true,
            color: '#475569',
            font: {
              family: 'Inter, system-ui, sans-serif',
              size: 13,
              weight: 500,
            },
          },
          position: 'bottom',
        },
        tooltip: {
          enabled: true,
        },
      },
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
    };
  }

  /**
   * Refreshes the list of pending documents for the current user.
   */
  async getPendingDocuments(): Promise<void> {
    await this.loadPendingDocuments();
  }

  /**
   * Handles mandatory reading acknowledgement completion.
   * Closes the viewer and refreshes the pending reading documents list.
   */
  async onDocumentAcknowledged(): Promise<void> {
    this.closePdfViewer();
    await this.getPendingDocuments();
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

    this.selectedDocument = doc;
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
   * Emits the acknowledge event, persists acknowledgement, and refreshes pending documents.
   */
  async confirmAcknowledgement(): Promise<void> {
    if (!this.acknowledgementChecked) {
      return;
    }
    if (this.selectedDocument?.id && this.currentUser()?.id) {
      try {
        await this.documentService.acknowledgeDocument(
          this.selectedDocument.id,
          this.currentUser()!.id,
        );
        this.messageService.add({
          severity: 'success',
          summary: 'Éxito',
          detail: 'Lectura confirmada correctamente',
          life: 4000,
        });
      } catch (error) {
        console.error('Error confirming document acknowledgement:', error);
      }
    }
    this.acknowledge.emit();
    await this.onDocumentAcknowledged();
  }

  /**
   * Closes the PDF viewer modal and resets the URL and acknowledgement state.
   */
  closePdfViewer(): void {
    this.isPdfViewerVisible = false;
    this.currentPdfUrl = null;
    this.selectedDocument = null;
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
