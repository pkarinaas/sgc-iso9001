import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonDirective } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MenuModule } from 'primeng/menu';
import { MenuItem, MessageService } from 'primeng/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

import {
  AuditReportService,
  type AuditActionType,
  type AuditLogEntry,
  type AuditRecord,
} from '../../../core/services/audit-report.service';
import { UserService } from '../../../core/services/user.service';
import {
  PROCESS_AREAS,
  type ProcessAreaOption,
} from '../../../core/constants/process-area.constant';
import {
  AUDIT_ACTION_OPTIONS,
  formatAuditActor,
  formatAuditDetail,
  formatAuditTimestamp,
  getAuditActionPresentation,
  sanitizeForPdf,
  type AuditActionPresentation,
} from '../../../core/utils/audit-format.util';

export interface DropdownOption<T = string | null> {
  label: string;
  value: T;
}

/**
 * AuditReportsComponent presents an interactive ISO 9001 audit report interface.
 * Provides tabs for Read Acknowledgements traceability and Global Audit Logs
 * filtered by user, document, action type, and date range.
 */
@Component({
  selector: 'app-audit-reports',
  standalone: true,
  templateUrl: './audit-reports.component.html',
  styleUrl: './audit-reports.component.css',
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    TableModule,
    Select,
    DatePicker,
    InputTextModule,
    ButtonDirective,
    TagModule,
    ToastModule,
    MenuModule,
  ],
  providers: [MessageService],
})
export class AuditReportsComponent implements OnInit {
  private readonly auditReportService = inject(AuditReportService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  /** Active tab inside Audit Reports ('acknowledgements' | 'auditLogs'). */
  readonly activeTab = signal<'acknowledgements' | 'auditLogs'>('acknowledgements');

  /** Raw complete list of audit records fetched from backend view. */
  allRecords = signal<AuditRecord[]>([]);

  /** Filtered list of audit records displayed in the preview table. */
  filteredRecords: AuditRecord[] = [];

  /** Raw complete list of chronological audit logs fetched from `audit_logs`. */
  allAuditLogs = signal<AuditLogEntry[]>([]);

  /** Filtered list of audit log entries displayed in the audit history table. */
  filteredAuditLogs: AuditLogEntry[] = [];

  /** Loading state indicator for queries and filtering operations. */
  loading = signal<boolean>(false);

  /** Menu items for export options popup menu. */
  exportMenuItems: MenuItem[] = [];

  /** Menu items for exporting filtered global audit logs. */
  auditLogExportMenuItems: MenuItem[] = [];

  // Read Acknowledgements Filters State
  ackDocumentSearchQuery = '';
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  selectedArea: string | null = null;
  selectedUser: string | null = null;

  // Global Audit Logs Filters State
  selectedLogUser: string | null = null;
  documentSearchQuery = '';
  selectedActionType: AuditActionType | null = null;
  logDateFrom: Date | null = null;
  logDateTo: Date | null = null;

  /** Area dropdown filter options. */
  areaOptions: DropdownOption[] = [
    { label: 'Todos los Procesos', value: null },
    ...PROCESS_AREAS.map((a: ProcessAreaOption) => ({ label: a.label, value: a.value })),
  ];

  /** User dropdown filter options. */
  userOptions: DropdownOption[] = [{ label: 'Todos los usuarios', value: null }];

  /** Action type dropdown filter options for global audit history. */
  readonly actionTypeOptions: { label: string; value: AuditActionType | null }[] =
    AUDIT_ACTION_OPTIONS;

  async ngOnInit(): Promise<void> {
    this.exportMenuItems = [
      {
        label: 'Exportar a PDF',
        icon: 'pi pi-file-pdf',
        command: () => this.exportPdf(),
      },
      {
        label: 'Exportar a Excel',
        icon: 'pi pi-file-excel',
        command: () => this.exportExcel(),
      },
    ];
    this.auditLogExportMenuItems = [
      {
        label: 'Exportar a PDF',
        icon: 'pi pi-file-pdf',
        command: () => this.exportAuditLogsPdf(),
      },
      {
        label: 'Exportar a Excel',
        icon: 'pi pi-file-excel',
        command: () => this.exportAuditLogsExcel(),
      },
    ];
    await this.loadData();
  }

  /**
   * Switches between the Read Acknowledgements and Global Audit Logs tabs.
   */
  setActiveTab(tab: 'acknowledgements' | 'auditLogs'): void {
    this.activeTab.set(tab);
  }

  /**
   * Loads read acknowledgement audit records, global audit logs, and user options.
   */
  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const fetchAuditLogsPromise =
        typeof this.auditReportService.getAuditLogs === 'function'
          ? this.auditReportService.getAuditLogs().catch(() => [])
          : Promise.resolve<AuditLogEntry[]>([]);

      const [records, logs] = await Promise.all([
        this.auditReportService.getAuditRecords(),
        fetchAuditLogsPromise,
        this.userService.loadUsers().catch(() => undefined),
      ]).then(([ackRecords, auditEntries]) => [ackRecords, auditEntries] as const);

      this.allRecords.set(records);
      this.allAuditLogs.set(logs);
      this.populateUserOptions(records, logs);
      this.applyFilters();
      this.applyAuditLogFilters();
    } catch (error: unknown) {
      console.error('Error loading audit report data:', error);
      const detail =
        error instanceof Error && error.message
          ? error.message
          : 'Error al cargar los registros de auditoría.';
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail,
      });
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Populates the user dropdown options from UserService or audit records fallback.
   */
  private populateUserOptions(records: AuditRecord[], logs: AuditLogEntry[] = []): void {
    const loadedUsers = this.userService.users();
    const userMap = new Map<string, string>();

    if (loadedUsers && loadedUsers.length > 0) {
      for (const u of loadedUsers) {
        userMap.set(u.id, u.full_name);
      }
    } else {
      for (const r of records) {
        if (r.user_id && r.user_name) {
          userMap.set(r.user_id, r.user_name);
        }
      }
      for (const entry of logs) {
        if (entry.user_id && entry.user_name && !userMap.has(entry.user_id)) {
          userMap.set(entry.user_id, entry.user_name);
        }
      }
    }

    this.userOptions = [
      { label: 'Todos los usuarios', value: null },
      ...Array.from(userMap.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => ({ label: name, value: id })),
    ];
  }

  /**
   * Filters the audit records in memory according to active filter criteria.
   */
  applyFilters(): void {
    let result = [...this.allRecords()];

    // 1. Document search filter (code or title, case-insensitive)
    const docQuery = this.ackDocumentSearchQuery.trim().toLowerCase();
    if (docQuery) {
      result = result.filter((r) => this.matchesDocumentQuery(r, docQuery));
    }

    // 2. Process Area filter
    if (this.selectedArea) {
      const targetArea = this.selectedArea.toLowerCase().replace(/_/g, ' ');
      result = result.filter((r) => {
        if (!r.process_area) return false;
        const recordArea = r.process_area.toLowerCase().replace(/_/g, ' ');
        return (
          recordArea === targetArea ||
          r.process_area.toLowerCase() === this.selectedArea?.toLowerCase()
        );
      });
    }

    // 3. User filter
    if (this.selectedUser) {
      result = result.filter(
        (r) => r.user_id === this.selectedUser || r.user_name === this.selectedUser,
      );
    }

    // 4. Date range filter (Desde / Hasta)
    if (this.dateFrom || this.dateTo) {
      const startDate = this.dateFrom ? new Date(this.dateFrom) : null;
      const endDate = this.dateTo ? new Date(this.dateTo) : null;

      if (startDate) {
        startDate.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        endDate.setHours(23, 59, 59, 999);
      }

      result = result.filter((r) => {
        if (!r.read_at) return false;
        const readDate = new Date(r.read_at);
        if (Number.isNaN(readDate.getTime())) return false;

        if (startDate && readDate < startDate) return false;
        if (endDate && readDate > endDate) return false;
        return true;
      });
    }

    this.filteredRecords = result;
  }

  /**
   * Resets all filter controls and restores the complete audit dataset preview.
   */
  resetFilters(): void {
    this.ackDocumentSearchQuery = '';
    this.dateFrom = null;
    this.dateTo = null;
    this.selectedArea = null;
    this.selectedUser = null;
    this.applyFilters();
  }

  /**
   * Maps internal database role codes to their Spanish UI labels.
   */
  mapRoleToSpanish(role: string | null | undefined): string {
    if (!role) return '—';
    const labels: Record<string, string> = {
      ADMIN: 'Administrador',
      VIEWER: 'Lector',
      EDITOR: 'Editor',
      REVIEWER: 'Revisor',
      APPROVER: 'Aprobador',
    };
    return labels[role.toUpperCase()] ?? role;
  }

  /**
   * Formats a process area identifier into its human-readable Spanish name.
   */
  getProcessAreaLabel(area: string | null | undefined): string {
    if (!area) return 'N/A';
    const found = PROCESS_AREAS.find(
      (p) =>
        p.value.toLowerCase() === area.toLowerCase() ||
        p.label.toLowerCase() === area.toLowerCase(),
    );
    return found ? found.label : area;
  }

  /**
   * Returns a PrimeNG tag severity corresponding to the user role.
   */
  getRoleSeverity(
    role: string | null | undefined,
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (role?.toUpperCase()) {
      case 'ADMIN':
        return 'danger';
      case 'APPROVER':
        return 'success';
      case 'REVIEWER':
        return 'info';
      case 'EDITOR':
        return 'warn';
      default:
        return 'secondary';
    }
  }

  /**
   * Formats a date string into DD/MM/YYYY HH:mm for exports and reports.
   */
  formatReadDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '—';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  /**
   * Exports currently filtered audit records into a PDF file using jsPDF and jspdf-autotable.
   */
  exportPdf(): void {
    const records = this.filteredRecords;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.setTextColor(136, 19, 55);
    doc.text('Registro de Confirmaciones de Lectura de Documentos', 14, 18);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Fecha de exportación: ${new Date().toLocaleDateString('es-ES')}`, 14, 25);
    doc.text(`Total de registros: ${records.length}`, 14, 30);

    const head = [['Documento', 'Proceso', 'Usuario', 'Rol', 'Fecha de Lectura']];
    const body = records.map((r) => [
      sanitizeForPdf(`${r.doc_code || ''} - ${r.doc_title || ''}`),
      sanitizeForPdf(this.getProcessAreaLabel(r.process_area)),
      sanitizeForPdf(r.user_name || '-'),
      sanitizeForPdf(this.mapRoleToSpanish(r.user_role)),
      sanitizeForPdf(this.formatReadDate(r.read_at)),
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

    doc.save('reporte-auditoria-lecturas.pdf');
  }

  /**
   * Exports currently filtered audit records into an Excel (.xlsx) spreadsheet using xlsx.
   */
  exportExcel(): void {
    const records = this.filteredRecords;
    const data = records.map((r) => ({
      Documento: `${r.doc_code || ''} - ${r.doc_title || ''}`,
      Proceso: this.getProcessAreaLabel(r.process_area),
      Usuario: r.user_name || '—',
      Rol: this.mapRoleToSpanish(r.user_role),
      'Fecha de Lectura': this.formatReadDate(r.read_at),
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Confirmaciones de Lectura');
    XLSX.writeFile(workbook, 'reporte-auditoria-lecturas.xlsx');
  }

  /**
   * Filters global audit log entries in memory by user, document query,
   * action type, and date range (`Desde` / `Hasta`).
   */
  applyAuditLogFilters(): void {
    let result = [...this.allAuditLogs()];

    if (this.selectedLogUser) {
      result = result.filter(
        (entry) =>
          entry.user_id === this.selectedLogUser || entry.user_name === this.selectedLogUser,
      );
    }

    const docQuery = this.documentSearchQuery.trim().toLowerCase();
    if (docQuery) {
      result = result.filter((entry) => this.matchesDocumentQuery(entry, docQuery));
    }

    if (this.selectedActionType) {
      result = result.filter((entry) => entry.action === this.selectedActionType);
    }

    if (this.logDateFrom || this.logDateTo) {
      const startDate = this.logDateFrom ? new Date(this.logDateFrom) : null;
      const endDate = this.logDateTo ? new Date(this.logDateTo) : null;

      if (startDate) {
        startDate.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        endDate.setHours(23, 59, 59, 999);
      }

      result = result.filter((entry) => {
        if (!entry.created_at) return false;
        const createdDate = new Date(entry.created_at);
        if (Number.isNaN(createdDate.getTime())) return false;

        if (startDate && createdDate < startDate) return false;
        if (endDate && createdDate > endDate) return false;
        return true;
      });
    }

    this.filteredAuditLogs = result;
  }

  /** Returns true when an item matches a trimmed lowercase query by code or title. */
  private matchesDocumentQuery(
    item: { doc_code?: string | null; doc_title?: string | null },
    normalizedQuery: string,
  ): boolean {
    const code = (item.doc_code ?? '').toLowerCase();
    const title = (item.doc_title ?? '').toLowerCase();
    return code.includes(normalizedQuery) || title.includes(normalizedQuery);
  }

  /**
   * Resets all global audit log filter criteria and restores full history.
   */
  resetAuditLogFilters(): void {
    this.selectedLogUser = null;
    this.documentSearchQuery = '';
    this.selectedActionType = null;
    this.logDateFrom = null;
    this.logDateTo = null;
    this.applyAuditLogFilters();
  }

  /** Returns visual badge metadata for an audit log action type. */
  getActionPresentation(action: string): AuditActionPresentation {
    return getAuditActionPresentation(action);
  }

  /** Returns the formatted Spanish detail description for an audit log row. */
  getAuditDetail(entry: AuditLogEntry): string {
    return formatAuditDetail(entry);
  }

  /** Returns the formatted actor display name for an audit log row. */
  getAuditActor(entry: AuditLogEntry): string {
    return formatAuditActor(entry);
  }

  /** Formats an audit log timestamp into `dd/MM/yyyy HH:mm`. */
  formatAuditLogTimestamp(dateStr: string | null | undefined): string {
    return formatAuditTimestamp(dateStr);
  }

  /** Formats a numeric document version as `v00`, `v01`, etc. */
  formatAuditLogVersion(version: number | null | undefined): string {
    if (version === null || version === undefined || Number.isNaN(Number(version))) {
      return '';
    }
    const numeric = Number(version);
    return Number.isInteger(numeric)
      ? `v${String(numeric).padStart(2, '0')}`
      : `v${numeric.toFixed(1)}`;
  }

  /**
   * Exports currently filtered global audit logs into a PDF report.
   */
  exportAuditLogsPdf(): void {
    const logs = this.filteredAuditLogs;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.setTextColor(136, 19, 55);
    doc.text('Historial Global de Trazabilidad - SGC', 14, 18);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Fecha de exportación: ${new Date().toLocaleDateString('es-ES')}`, 14, 25);
    doc.text(`Total de eventos: ${logs.length}`, 14, 30);

    const head = [['Fecha y Hora', 'Acción', 'Documento', 'Usuario', 'Detalle']];
    const body = logs.map((entry) => [
      sanitizeForPdf(this.formatAuditLogTimestamp(entry.created_at)),
      sanitizeForPdf(this.getActionPresentation(entry.action).label),
      sanitizeForPdf(`${entry.doc_code || 'S/C'} - ${entry.doc_title || 'Documento'}`),
      sanitizeForPdf(this.getAuditActor(entry)),
      sanitizeForPdf(this.getAuditDetail(entry)),
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

    doc.save('historial-auditoria-sgc.pdf');
  }

  /**
   * Exports currently filtered global audit logs into an Excel (.xlsx) workbook.
   */
  exportAuditLogsExcel(): void {
    const logs = this.filteredAuditLogs;
    const data = logs.map((entry) => ({
      'Fecha y Hora': this.formatAuditLogTimestamp(entry.created_at),
      Acción: this.getActionPresentation(entry.action).label,
      Documento: `${entry.doc_code || 'S/C'} - ${entry.doc_title || 'Documento'}`,
      Usuario: this.getAuditActor(entry),
      Detalle: this.getAuditDetail(entry),
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Historial de Auditoría');
    XLSX.writeFile(workbook, 'historial-auditoria-sgc.xlsx');
  }
}
