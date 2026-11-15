import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { ButtonDirective } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { AuditReportService, type AuditRecord } from '../../../core/services/audit-report.service';
import { UserService } from '../../../core/services/user.service';
import {
  PROCESS_AREAS,
  type ProcessAreaOption,
} from '../../../core/constants/process-area.constant';

export interface DropdownOption<T = string | null> {
  label: string;
  value: T;
}

/**
 * AuditReportsComponent presents an interactive ISO 9001 audit report interface.
 * Allows auditors and quality managers to filter document reading acknowledgements
 * by date range, process area, and user, displaying a tabular preview of compliance records.
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
    ButtonDirective,
    TagModule,
    ToastModule,
  ],
  providers: [MessageService],
})
export class AuditReportsComponent implements OnInit {
  private readonly auditReportService = inject(AuditReportService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  /** Raw complete list of audit records fetched from backend view. */
  allRecords = signal<AuditRecord[]>([]);

  /** Filtered list of audit records displayed in the preview table. */
  filteredRecords: AuditRecord[] = [];

  /** Loading state indicator for queries and filtering operations. */
  loading = signal<boolean>(false);

  // Filters State
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  selectedArea: string | null = null;
  selectedUser: string | null = null;

  /** Area dropdown filter options. */
  areaOptions: DropdownOption[] = [
    { label: 'Todos los Procesos', value: null },
    ...PROCESS_AREAS.map((a: ProcessAreaOption) => ({ label: a.label, value: a.value })),
  ];

  /** User dropdown filter options. */
  userOptions: DropdownOption[] = [{ label: 'Todos los usuarios', value: null }];

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  /**
   * Loads audit records and user options from backend services.
   */
  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [records] = await Promise.all([
        this.auditReportService.getAuditRecords(),
        this.userService.loadUsers().catch(() => {}),
      ]);

      this.allRecords.set(records);
      this.populateUserOptions(records);
      this.applyFilters();
    } catch (error: any) {
      console.error('Error loading audit report data:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: error?.message || 'Error al cargar los registros de auditoría.',
      });
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Populates the user dropdown options from UserService or records fallback.
   */
  private populateUserOptions(records: AuditRecord[]): void {
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

    // 1. Process Area filter
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

    // 2. User filter
    if (this.selectedUser) {
      result = result.filter(
        (r) => r.user_id === this.selectedUser || r.user_name === this.selectedUser,
      );
    }

    // 3. Date range filter (Desde / Hasta)
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
}
