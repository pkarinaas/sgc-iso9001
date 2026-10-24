import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FilterService } from 'primeng/api';
import { DocumentListComponent } from './document-list';
import { DocumentService } from '../../../core/services/document.service';
import type { Document } from '../../../core/models/document.model';

describe('DocumentListComponent', () => {
  let component: DocumentListComponent;
  let fixture: ComponentFixture<DocumentListComponent>;

  const mockDocuments: Document[] = [
    {
      id: 'doc-1',
      code: 'SGC-MAN-001',
      title: 'Manual de Calidad',
      version: 1,
      status: 'APPROVED',
      file_url: 'https://storage.supabase.com/docs/manual.pdf',
      creator_id: 'usr-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const mockDocumentService = {
    documents: signal<Document[]>(mockDocuments),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    loadDocuments: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentListComponent],
      providers: [
        provideNoopAnimations(),
        FilterService,
        { provide: DocumentService, useValue: mockDocumentService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize dialog state and form controls correctly', () => {
    expect(component.isDialogVisible).toBe(false);
    expect(component.isSubmitting).toBe(false);

    expect(component.documentForm.get('title')?.value).toBe('');
    expect(component.documentForm.get('code')?.value).toBe('');
    expect(component.documentForm.get('version')?.value).toBe('00');
    expect(component.documentForm.get('file')?.value).toBeNull();
    expect(component.documentForm.invalid).toBe(true);
  });

  it('should validate that title, version and file are required and version allows 00 and 01', () => {
    const titleCtrl = component.documentForm.get('title');
    const versionCtrl = component.documentForm.get('version');
    const fileCtrl = component.documentForm.get('file');

    expect(titleCtrl?.valid).toBe(false);
    expect(titleCtrl?.hasError('required')).toBe(true);

    // Version allows '00' and '01'
    expect(versionCtrl?.valid).toBe(true);
    versionCtrl?.setValue('00');
    expect(versionCtrl?.valid).toBe(true);
    versionCtrl?.setValue('01');
    expect(versionCtrl?.valid).toBe(true);

    // Non-numeric characters are invalid
    versionCtrl?.setValue('abc');
    expect(versionCtrl?.valid).toBe(false);
    expect(versionCtrl?.hasError('pattern')).toBe(true);

    versionCtrl?.setValue('');
    expect(versionCtrl?.valid).toBe(false);
    expect(versionCtrl?.hasError('required')).toBe(true);

    expect(fileCtrl?.valid).toBe(false);
    expect(fileCtrl?.hasError('required')).toBe(true);
  });

  it('should open upload dialog and reset the form when openUploadDialog is called', () => {
    component.documentForm.patchValue({
      title: 'Procedimiento de Auditoría',
      code: 'SGC-PRC-002',
      version: '03',
      file: new File(['content'], 'test.pdf', { type: 'application/pdf' }),
    });

    component.openUploadDialog();

    expect(component.isDialogVisible).toBe(true);
    expect(component.documentForm.get('title')?.value).toBe('');
    expect(component.documentForm.get('code')?.value).toBe('');
    expect(component.documentForm.get('version')?.value).toBe('00');
    expect(component.documentForm.get('file')?.value).toBeNull();
  });

  it('should close upload dialog when closeUploadDialog is called', () => {
    component.isDialogVisible = true;
    component.closeUploadDialog();
    expect(component.isDialogVisible).toBe(false);
  });

  it('should assign selected file to documentForm when onFileSelect is triggered', () => {
    const fakeFile = new File(['fake content'], 'sgc-doc.pdf', { type: 'application/pdf' });
    const selectEvent = {
      files: [fakeFile],
    };

    component.onFileSelect(selectEvent);

    expect(component.documentForm.get('file')?.value).toBe(fakeFile);
    expect(component.documentForm.get('file')?.valid).toBe(true);
  });

  it('should mark form valid when all required fields (title, numeric version like 00, file) are provided', () => {
    const fakeFile = new File(['dummy'], 'norma.pdf', { type: 'application/pdf' });

    component.documentForm.patchValue({
      title: 'Política de Calidad',
      code: 'SGC-POL-001',
      version: '00',
      file: fakeFile,
    });

    expect(component.documentForm.valid).toBe(true);
  });

  it('should correctly format version strings and numbers', () => {
    expect(component.formatVersion('00')).toBe('v00');
    expect(component.formatVersion('01')).toBe('v01');
    expect(component.formatVersion('v02')).toBe('v02');
    expect(component.formatVersion(0)).toBe('v00');
    expect(component.formatVersion(1)).toBe('v01');
    expect(component.formatVersion(1.5)).toBe('v1.5');
  });
});
