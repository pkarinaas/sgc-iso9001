import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { MessageService, type MenuItemCommandEvent } from 'primeng/api';

const mockSavePdf = vi.fn();
vi.mock('jspdf', () => {
  return {
    default: class MockJsPDF {
      setFontSize = vi.fn();
      setTextColor = vi.fn();
      text = vi.fn();
      save = mockSavePdf;
    },
  };
});

const mockAutoTable = vi.fn();
vi.mock('jspdf-autotable', () => ({
  default: (...args: unknown[]) => mockAutoTable(...args),
}));

const mockWriteFile = vi.fn();
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return {
    ...actual,
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  };
});

import * as XLSX from 'xlsx';

import { AuditReportsComponent } from './audit-reports.component';
import {
  AuditReportService,
  type AuditLogEntry,
  type AuditRecord,
} from '../../../core/services/audit-report.service';
import { UserService } from '../../../core/services/user.service';
import { sanitizeForPdf } from '../../../core/utils/audit-format.util';
import type { User } from '../../../core/models/user.model';

describe('AuditReportsComponent', () => {
  let component: AuditReportsComponent;
  let fixture: ComponentFixture<AuditReportsComponent>;

  const mockAuditRecords: AuditRecord[] = [
    {
      ack_id: 'ack-1',
      document_id: 101,
      doc_code: 'SGC-PR-001',
      doc_title: 'Procedimiento de Muestras',
      doc_version: 1,
      process_area: 'quimica_clinica',
      doc_status: 'APPROVED',
      user_id: 'usr-1',
      user_name: 'Carlos Gómez',
      user_email: 'carlos@empresa.com',
      user_role: 'ADMIN',
      read_at: '2026-11-10T10:00:00Z',
      signature_hash: 'hash-1',
    },
    {
      ack_id: 'ack-2',
      document_id: 102,
      doc_code: 'SGC-PR-002',
      doc_title: 'Control de Equipos',
      doc_version: 2,
      process_area: 'calidad',
      doc_status: 'APPROVED',
      user_id: 'usr-2',
      user_name: 'María López',
      user_email: 'maria@empresa.com',
      user_role: 'REVIEWER',
      read_at: '2026-11-05T15:30:00Z',
      signature_hash: 'hash-2',
    },
    {
      ack_id: 'ack-3',
      document_id: 103,
      doc_code: 'SGC-IT-003',
      doc_title: 'Instructivo de Limpieza',
      doc_version: 1,
      process_area: 'quimica_clinica',
      doc_status: 'APPROVED',
      user_id: 'usr-3',
      user_name: 'Juan Pérez',
      user_email: 'juan@empresa.com',
      user_role: 'VIEWER',
      read_at: '2026-10-20T12:00:00Z',
      signature_hash: 'hash-3',
    },
  ];

  const mockUsers: User[] = [
    {
      id: 'usr-1',
      full_name: 'Carlos Gómez',
      email: 'carlos@empresa.com',
      role_id: 1,
      is_active: true,
      created_at: '',
    },
    {
      id: 'usr-2',
      full_name: 'María López',
      email: 'maria@empresa.com',
      role_id: 3,
      is_active: true,
      created_at: '',
    },
    {
      id: 'usr-3',
      full_name: 'Juan Pérez',
      email: 'juan@empresa.com',
      role_id: 5,
      is_active: true,
      created_at: '',
    },
  ];

  const mockAuditLogs: AuditLogEntry[] = [
    {
      id: 'log-1',
      user_id: 'usr-1',
      document_id: 101,
      action: 'DOCUMENT_CREATED',
      details: { new_status: 'DRAFT', document_version: 0 },
      created_at: '2026-11-10T10:00:00Z',
      user_name: 'Carlos Gómez',
      user_email: 'carlos@empresa.com',
      doc_code: 'SGC-PR-001',
      doc_title: 'Procedimiento de Muestras',
      doc_version: 0,
    },
    {
      id: 'log-2',
      user_id: 'usr-2',
      document_id: 102,
      action: 'DOCUMENT_APPROVED',
      details: { old_status: 'REVIEWED', new_status: 'APPROVED', document_version: 2 },
      created_at: '2026-11-05T15:30:00Z',
      user_name: 'María López',
      user_email: 'maria@empresa.com',
      doc_code: 'SGC-PR-002',
      doc_title: 'Control de Equipos',
      doc_version: 2,
    },
    {
      id: 'log-3',
      user_id: null,
      document_id: 103,
      action: 'DRIVE_SYNC_SUCCESS',
      details: { drive_file_id: 'drv-103' },
      created_at: '2026-10-20T12:00:00Z',
      user_name: null,
      user_email: null,
      doc_code: 'SGC-IT-003',
      doc_title: 'Instructivo de Limpieza',
      doc_version: 1,
    },
  ];

  let mockAuditReportService: {
    getAuditRecords: ReturnType<typeof vi.fn>;
    getAuditLogs: ReturnType<typeof vi.fn>;
    records: ReturnType<typeof signal<AuditRecord[]>>;
    auditLogs: ReturnType<typeof signal<AuditLogEntry[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    auditLogsLoading: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
  };

  let mockUserService: {
    users: ReturnType<typeof signal<User[]>>;
    loadUsers: ReturnType<typeof vi.fn>;
  };

  let mockMessageService: MessageService;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockAuditReportService = {
      getAuditRecords: vi.fn().mockResolvedValue(mockAuditRecords),
      getAuditLogs: vi.fn().mockResolvedValue(mockAuditLogs),
      records: signal(mockAuditRecords),
      auditLogs: signal(mockAuditLogs),
      loading: signal(false),
      auditLogsLoading: signal(false),
      error: signal(null),
    };

    mockUserService = {
      users: signal(mockUsers),
      loadUsers: vi.fn().mockResolvedValue(undefined),
    };

    mockMessageService = new MessageService();
    vi.spyOn(mockMessageService, 'add');

    await TestBed.configureTestingModule({
      imports: [AuditReportsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AuditReportService, useValue: mockAuditReportService },
        { provide: UserService, useValue: mockUserService },
        { provide: MessageService, useValue: mockMessageService },
      ],
    })
      .overrideComponent(AuditReportsComponent, {
        set: {
          providers: [{ provide: MessageService, useValue: mockMessageService }],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AuditReportsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should load audit records and populate userOptions on initialization', () => {
    expect(mockAuditReportService.getAuditRecords).toHaveBeenCalled();
    expect(component.allRecords().length).toBe(3);
    expect(component.filteredRecords.length).toBe(3);

    expect(component.areaOptions.length).toBeGreaterThan(1);
    expect(component.userOptions.length).toBe(4); // "Todos los usuarios" + 3 users
  });

  describe('Filtering Functionality', () => {
    it('should filter records by document code or title (case-insensitive)', () => {
      component.ackDocumentSearchQuery = 'sgc-pr-002';
      component.applyFilters();

      expect(component.filteredRecords).toHaveLength(1);
      expect(component.filteredRecords[0].ack_id).toBe('ack-2');

      component.ackDocumentSearchQuery = 'MUESTRAS';
      component.applyFilters();

      expect(component.filteredRecords).toHaveLength(1);
      expect(component.filteredRecords[0].ack_id).toBe('ack-1');
    });

    it('should filter records by process area', () => {
      component.selectedArea = 'quimica_clinica';
      component.applyFilters();

      expect(component.filteredRecords.length).toBe(2);
      expect(component.filteredRecords.every((r) => r.process_area === 'quimica_clinica')).toBe(true);
    });

    it('should filter records by user', () => {
      component.selectedUser = 'usr-2';
      component.applyFilters();

      expect(component.filteredRecords.length).toBe(1);
      expect(component.filteredRecords[0].user_name).toBe('María López');
    });

    it('should filter records by date range', () => {
      // Range: 2026-11-01 to 2026-11-15
      component.dateFrom = new Date('2026-11-01T00:00:00');
      component.dateTo = new Date('2026-11-15T23:59:59');
      component.applyFilters();

      expect(component.filteredRecords.length).toBe(2);
      expect(component.filteredRecords.map((r) => r.doc_code)).toEqual(['SGC-PR-001', 'SGC-PR-002']);
    });

    it('should filter records by single start date', () => {
      // Range with single date: only records from 2026-11-10
      component.dateFrom = new Date('2026-11-10T00:00:00');
      component.dateTo = null;
      component.applyFilters();

      expect(component.filteredRecords.length).toBe(1);
      expect(component.filteredRecords[0].doc_code).toBe('SGC-PR-001');
    });

    it('should combine multiple filters simultaneously (Area + User + Date)', () => {
      component.selectedArea = 'quimica_clinica';
      component.selectedUser = 'usr-1';
      component.dateFrom = new Date('2026-11-01');
      component.dateTo = new Date('2026-11-30');
      component.applyFilters();

      expect(component.filteredRecords.length).toBe(1);
      expect(component.filteredRecords[0].ack_id).toBe('ack-1');
    });

    it('should restore all records when resetFilters is called', () => {
      component.ackDocumentSearchQuery = 'equipos';
      component.selectedArea = 'calidad';
      component.selectedUser = 'usr-2';
      component.dateFrom = new Date('2026-11-01');
      component.dateTo = new Date('2026-11-10');
      component.applyFilters();
      expect(component.filteredRecords.length).toBe(1);

      component.resetFilters();

      expect(component.ackDocumentSearchQuery).toBe('');
      expect(component.selectedArea).toBeNull();
      expect(component.selectedUser).toBeNull();
      expect(component.dateFrom).toBeNull();
      expect(component.dateTo).toBeNull();
      expect(component.filteredRecords.length).toBe(3);
    });
  });

  describe('UI Elements and Template', () => {
    it('should render header with title and description', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const title = compiled.querySelector('.audit-reports-header h1');
      expect(title?.textContent).toContain('Reportes de Auditoría');
    });

    it('should render Tab 1 filter controls in exact order without Apply button', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('#filter-document')).toBeTruthy();
      expect(compiled.querySelector('#filter-area')).toBeTruthy();
      expect(compiled.querySelector('#filter-user')).toBeTruthy();
      expect(compiled.querySelector('#filter-date-from')).toBeTruthy();
      expect(compiled.querySelector('#filter-date-to')).toBeTruthy();
      expect(compiled.querySelector('#btn-reset-filters')).toBeTruthy();
      expect(compiled.querySelector('#btn-reset-filters .pi-refresh')).toBeTruthy();
      expect(compiled.querySelector('#btn-apply-filters')).toBeNull();

      const filterControls = Array.from(
        compiled.querySelectorAll(
          '.audit-filters-bar #filter-document, .audit-filters-bar #filter-area, .audit-filters-bar #filter-user, .audit-filters-bar #filter-date-from, .audit-filters-bar #filter-date-to, .audit-filters-bar #btn-reset-filters',
        ),
      ).map((el) => el.id);

      expect(filterControls).toEqual([
        'filter-document',
        'filter-area',
        'filter-user',
        'filter-date-from',
        'filter-date-to',
        'btn-reset-filters',
      ]);
    });

    it('should render table columns for Documento, Área/Proceso, Usuario, Rol, and Fecha de Lectura', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const thElements = Array.from(compiled.querySelectorAll('th')).map((th) =>
        th.textContent?.trim(),
      );

      expect(thElements.some((t) => t?.includes('Documento'))).toBe(true);
      expect(thElements.some((t) => t?.includes('Área') || t?.includes('Proceso'))).toBe(true);
      expect(thElements.some((t) => t?.includes('Usuario'))).toBe(true);
      expect(thElements.some((t) => t?.includes('Rol'))).toBe(true);
      expect(thElements.some((t) => t?.includes('Fecha de Lectura'))).toBe(true);
    });

    it('should display audit records data in the table body', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const rows = compiled.querySelectorAll('tbody tr');
      expect(rows.length).toBe(3);

      const firstRowText = rows[0].textContent;
      expect(firstRowText).toContain('SGC-PR-001');
      expect(firstRowText).toContain('Procedimiento de Muestras');
      expect(firstRowText).toContain('Carlos Gómez');
      expect(firstRowText).toContain('Administrador');
      expect(firstRowText).not.toContain('carlos@empresa.com');
    });

    it('should reactively filter records when typing in document search input', async () => {
      const applyFiltersSpy = vi.spyOn(component, 'applyFilters');
      const compiled = fixture.nativeElement as HTMLElement;
      const docInput = compiled.querySelector('#filter-document') as HTMLInputElement;

      docInput.value = 'Equipos';
      docInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(applyFiltersSpy).toHaveBeenCalled();
      expect(component.filteredRecords).toHaveLength(1);
      expect(component.filteredRecords[0].doc_code).toBe('SGC-PR-002');
      const rows = compiled.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('Control de Equipos');
    });

    it('should trigger resetFilters when "Limpiar" button is clicked', () => {
      const resetFiltersSpy = vi.spyOn(component, 'resetFilters');
      const btn = fixture.nativeElement.querySelector('#btn-reset-filters') as HTMLButtonElement;
      btn.click();

      expect(resetFiltersSpy).toHaveBeenCalled();
    });

    it('should render empty state message when no records match filters', () => {
      component.selectedArea = 'inmunologia';
      component.applyFilters();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const emptyRow = compiled.querySelector('tbody tr td');
      expect(emptyRow?.textContent).toContain('No se encontraron registros');
    });
  });

  describe('Helper methods', () => {
    it('should format process area labels correctly', () => {
      expect(component.getProcessAreaLabel('quimica_clinica')).toBe('Química Clínica');
      expect(component.getProcessAreaLabel(null)).toBe('N/A');
    });

    it('should map internal roles to Spanish correctly', () => {
      expect(component.mapRoleToSpanish('ADMIN')).toBe('Administrador');
      expect(component.mapRoleToSpanish('VIEWER')).toBe('Lector');
      expect(component.mapRoleToSpanish('EDITOR')).toBe('Editor');
      expect(component.mapRoleToSpanish('REVIEWER')).toBe('Revisor');
      expect(component.mapRoleToSpanish('APPROVER')).toBe('Aprobador');
      expect(component.mapRoleToSpanish('CUSTOM_ROLE')).toBe('CUSTOM_ROLE');
      expect(component.mapRoleToSpanish(null)).toBe('—');
    });

    it('should return appropriate tag severity for roles', () => {
      expect(component.getRoleSeverity('ADMIN')).toBe('danger');
      expect(component.getRoleSeverity('APPROVER')).toBe('success');
      expect(component.getRoleSeverity('REVIEWER')).toBe('info');
      expect(component.getRoleSeverity('EDITOR')).toBe('warn');
      expect(component.getRoleSeverity('VIEWER')).toBe('secondary');
    });

    it('should handle loadData error and add error toast', async () => {
      mockAuditReportService.getAuditRecords.mockRejectedValueOnce(new Error('Connection error'));

      await component.loadData();

      expect(mockMessageService.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          detail: 'Connection error',
        }),
      );
    });
  });

  describe('Export Functionality', () => {
    it('should initialize exportMenuItems with PDF and Excel options', () => {
      expect(component.exportMenuItems).toHaveLength(2);
      expect(component.exportMenuItems[0].label).toBe('Exportar a PDF');
      expect(component.exportMenuItems[1].label).toBe('Exportar a Excel');
    });

    it('should render the export button and active tab header inside card', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const exportBtn = compiled.querySelector('.audit-card-header #btn-export-menu');
      expect(exportBtn).toBeTruthy();

      expect(compiled.querySelector('#tab-acknowledgements')?.textContent).toContain(
        'Confirmaciones de Lectura',
      );
      expect(compiled.querySelector('.audit-table-card h2')).toBeNull();
    });

    it('should format read dates as DD/MM/YYYY HH:mm', () => {
      const formatted = component.formatReadDate('2026-11-10T10:30:00Z');
      expect(formatted).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
      expect(component.formatReadDate(null)).toBe('—');
    });

    it('should export only filteredRecords to PDF and save file', () => {
      mockSavePdf.mockClear();
      mockAutoTable.mockClear();

      // Apply filter so only 1 record is visible
      component.selectedUser = 'usr-2';
      component.applyFilters();
      expect(component.filteredRecords).toHaveLength(1);

      component.exportPdf();

      expect(mockAutoTable).toHaveBeenCalled();
      const callArgs = mockAutoTable.mock.calls[0][1];
      expect(callArgs.head[0]).toEqual([
        'Documento',
        'Proceso',
        'Usuario',
        'Rol',
        'Fecha de Lectura',
      ]);
      expect(callArgs.body).toHaveLength(1);
      expect(callArgs.body[0][0]).toContain('SGC-PR-002');
      expect(callArgs.body[0][2]).toBe('María López');
      expect(callArgs.body[0][3]).toBe('Revisor');
      expect(mockSavePdf).toHaveBeenCalledWith('reporte-auditoria-lecturas.pdf');
    });

    it('should export only filteredRecords to Excel and call writeFile', () => {
      mockWriteFile.mockClear();
      const jsonToSheetSpy = vi.spyOn(XLSX.utils, 'json_to_sheet');

      // Apply filter
      component.selectedArea = 'calidad';
      component.applyFilters();
      expect(component.filteredRecords).toHaveLength(1);

      component.exportExcel();

      expect(jsonToSheetSpy).toHaveBeenCalled();
      const exportedData = jsonToSheetSpy.mock.calls[0][0] as Record<string, string>[];
      expect(exportedData).toHaveLength(1);
      expect(exportedData[0]['Documento']).toContain('SGC-PR-002');
      expect(exportedData[0]['Usuario']).toBe('María López');
      expect(exportedData[0]['Rol']).toBe('Revisor');
      expect(exportedData[0]).toHaveProperty('Fecha de Lectura');

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.anything(),
        'reporte-auditoria-lecturas.xlsx',
      );
    });

    it('should respect document search filter when exporting Tab 1 to PDF and Excel', () => {
      mockSavePdf.mockClear();
      mockAutoTable.mockClear();
      mockWriteFile.mockClear();
      const jsonToSheetSpy = vi.spyOn(XLSX.utils, 'json_to_sheet');

      component.ackDocumentSearchQuery = 'limpieza';
      component.applyFilters();
      expect(component.filteredRecords).toHaveLength(1);

      component.exportPdf();
      expect(mockAutoTable).toHaveBeenCalled();
      const pdfBody = mockAutoTable.mock.calls[0][1].body as string[][];
      expect(pdfBody).toHaveLength(1);
      expect(pdfBody[0][0]).toContain('SGC-IT-003');

      component.exportExcel();
      expect(jsonToSheetSpy).toHaveBeenCalled();
      const exportedData = jsonToSheetSpy.mock.calls[0][0] as Record<string, string>[];
      expect(exportedData).toHaveLength(1);
      expect(exportedData[0]['Documento']).toContain('SGC-IT-003');
    });

    it('should trigger exportPdf and exportExcel when menu items command is executed', () => {
      const exportPdfSpy = vi.spyOn(component, 'exportPdf').mockImplementation(() => undefined);
      const exportExcelSpy = vi.spyOn(component, 'exportExcel').mockImplementation(() => undefined);

      component.exportMenuItems[0].command?.({} as MenuItemCommandEvent);
      expect(exportPdfSpy).toHaveBeenCalled();

      component.exportMenuItems[1].command?.({} as MenuItemCommandEvent);
      expect(exportExcelSpy).toHaveBeenCalled();
    });
  });

  describe('Global Audit History Tab & Filters', () => {
    it('should render underline tabs inside the main report card and switch to strictly read-only audit rows', () => {
      const el = fixture.nativeElement as HTMLElement;
      const tabBar = el.querySelector('.audit-card-header .audit-tabs');
      expect(tabBar).toBeTruthy();

      const tabBtn = el.querySelector('#tab-audit-logs') as HTMLButtonElement;
      expect(tabBtn).toBeTruthy();

      tabBtn.click();
      fixture.detectChanges();

      expect(component.activeTab()).toBe('auditLogs');
      expect(tabBtn.getAttribute('aria-selected')).toBe('true');
      expect(el.querySelector('.audit-card-header #btn-export-logs-menu')).toBeTruthy();
      expect(el.querySelector('.audit-table-card h2')).toBeNull();
      expect(el.querySelector('#filter-log-user')).toBeTruthy();
      expect(el.querySelector('#filter-log-document')).toBeTruthy();
      expect(el.querySelector('#filter-log-action')).toBeTruthy();
      expect(el.querySelector('#filter-log-date-from')).toBeTruthy();
      expect(el.querySelector('#filter-log-date-to')).toBeTruthy();
      expect(el.querySelector('#btn-reset-log-filters')).toBeTruthy();
      expect(el.querySelector('#btn-reset-log-filters .pi-refresh')).toBeTruthy();
      expect(el.querySelector('#btn-reset-log-filters .pi-filter-slash')).toBeNull();

      const logFilterControls = Array.from(
        el.querySelectorAll(
          '.audit-log-filters-bar #filter-log-action, .audit-log-filters-bar #filter-log-document, .audit-log-filters-bar #filter-log-user, .audit-log-filters-bar #filter-log-date-from, .audit-log-filters-bar #filter-log-date-to, .audit-log-filters-bar #btn-reset-log-filters',
        ),
      ).map((node) => node.id);

      expect(logFilterControls).toEqual([
        'filter-log-action',
        'filter-log-document',
        'filter-log-user',
        'filter-log-date-from',
        'filter-log-date-to',
        'btn-reset-log-filters',
      ]);

      const rows = el.querySelectorAll('tbody tr');
      expect(rows.length).toBe(3);
      expect(rows[0].textContent).toContain('Creación');
      expect(rows[0].textContent).toContain('SGC-PR-001');
      expect(rows[0].textContent).toContain('Carlos Gómez');
      expect(rows[1].textContent).toContain('Estado: Revisado → Aprobado');
      expect(rows[2].textContent).toContain('Sistema (Google Drive)');
      expect(el.querySelector('tbody .pi-trash')).toBeNull();
      expect(el.querySelector('tbody .pi-pencil')).toBeNull();
    });

    it('should filter global audit logs by user, document query, action type, and date range', () => {
      component.selectedLogUser = 'usr-2';
      component.applyAuditLogFilters();
      expect(component.filteredAuditLogs).toHaveLength(1);
      expect(component.filteredAuditLogs[0].id).toBe('log-2');

      component.selectedLogUser = null;
      component.documentSearchQuery = 'limpieza';
      component.applyAuditLogFilters();
      expect(component.filteredAuditLogs).toHaveLength(1);
      expect(component.filteredAuditLogs[0].id).toBe('log-3');

      component.documentSearchQuery = '';
      component.selectedActionType = 'DOCUMENT_CREATED';
      component.applyAuditLogFilters();
      expect(component.filteredAuditLogs).toHaveLength(1);
      expect(component.filteredAuditLogs[0].id).toBe('log-1');

      component.selectedActionType = null;
      component.logDateFrom = new Date('2026-11-01T00:00:00');
      component.logDateTo = new Date('2026-11-15T23:59:59');
      component.applyAuditLogFilters();
      expect(component.filteredAuditLogs).toHaveLength(2);
    });

    it('should reset all audit log filters when clicking Limpiar and show empty state when nothing matches', () => {
      component.setActiveTab('auditLogs');
      component.selectedActionType = 'DOCUMENT_DELETED';
      component.applyAuditLogFilters();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(component.filteredAuditLogs).toHaveLength(0);
      expect(el.querySelector('tbody tr td')?.textContent).toContain(
        'No se encontraron registros de auditoría para los filtros seleccionados.',
      );

      const resetBtn = el.querySelector('#btn-reset-log-filters') as HTMLButtonElement;
      resetBtn.click();
      fixture.detectChanges();

      expect(component.selectedActionType).toBeNull();
      expect(component.documentSearchQuery).toBe('');
      expect(component.filteredAuditLogs).toHaveLength(3);
    });

    it('should export filtered audit logs to PDF with ASCII-safe arrows while preserving web UI arrows', () => {
      mockSavePdf.mockClear();
      mockAutoTable.mockClear();
      mockWriteFile.mockClear();

      expect(component.getAuditDetail(mockAuditLogs[1])).toBe('Estado: Revisado → Aprobado');

      component.selectedActionType = 'DOCUMENT_APPROVED';
      component.applyAuditLogFilters();
      component.exportAuditLogsPdf();
      component.exportAuditLogsExcel();

      expect(mockAutoTable).toHaveBeenCalled();
      const autoTableConfig = mockAutoTable.mock.calls[0][1] as { body: string[][] };
      expect(autoTableConfig.body[0][4]).toBe('Estado: Revisado -> Aprobado');
      expect(autoTableConfig.body[0][4]).not.toContain('→');
      expect(mockSavePdf).toHaveBeenCalledWith('historial-auditoria-sgc.pdf');
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.anything(),
        'historial-auditoria-sgc.xlsx',
      );
    });

    it('should sanitize unsupported Unicode characters cleanly for jsPDF', () => {
      expect(sanitizeForPdf('Estado: Revisado \u2192 Aprobado — “Revisión” ‘v01’')).toBe(
        'Estado: Revisado -> Aprobado - "Revisión" \'v01\'',
      );
    });
  });
});

