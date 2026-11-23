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
import { AuditReportService, type AuditRecord } from '../../../core/services/audit-report.service';
import { UserService } from '../../../core/services/user.service';
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

  let mockAuditReportService: {
    getAuditRecords: ReturnType<typeof vi.fn>;
    records: ReturnType<typeof signal<AuditRecord[]>>;
    loading: ReturnType<typeof signal<boolean>>;
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
      records: signal(mockAuditRecords),
      loading: signal(false),
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
      component.selectedArea = 'calidad';
      component.selectedUser = 'usr-2';
      component.dateFrom = new Date('2026-11-01');
      component.dateTo = new Date('2026-11-10');
      component.applyFilters();
      expect(component.filteredRecords.length).toBe(1);

      component.resetFilters();

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

    it('should render the filter inputs and action buttons in template', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('#filter-date-from')).toBeTruthy();
      expect(compiled.querySelector('#filter-date-to')).toBeTruthy();
      expect(compiled.querySelector('#filter-area')).toBeTruthy();
      expect(compiled.querySelector('#filter-user')).toBeTruthy();
      expect(compiled.querySelector('#btn-apply-filters')).toBeTruthy();
      expect(compiled.querySelector('#btn-reset-filters')).toBeTruthy();
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

    it('should trigger applyFilters when "Aplicar Filtros" button is clicked', () => {
      const applyFiltersSpy = vi.spyOn(component, 'applyFilters');
      const btn = fixture.nativeElement.querySelector('#btn-apply-filters') as HTMLButtonElement;
      btn.click();

      expect(applyFiltersSpy).toHaveBeenCalled();
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

    it('should render the export button and header in template', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const exportBtn = compiled.querySelector('#btn-export-menu');
      expect(exportBtn).toBeTruthy();

      const headerTitle = compiled.querySelector('.audit-table-card h2');
      expect(headerTitle?.textContent).toContain('Registro de Confirmaciones de Lectura');
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

    it('should trigger exportPdf and exportExcel when menu items command is executed', () => {
      const exportPdfSpy = vi.spyOn(component, 'exportPdf').mockImplementation(() => undefined);
      const exportExcelSpy = vi.spyOn(component, 'exportExcel').mockImplementation(() => undefined);

      component.exportMenuItems[0].command?.({} as MenuItemCommandEvent);
      expect(exportPdfSpy).toHaveBeenCalled();

      component.exportMenuItems[1].command?.({} as MenuItemCommandEvent);
      expect(exportExcelSpy).toHaveBeenCalled();
    });
  });
});

