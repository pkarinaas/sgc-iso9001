import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PdfViewerComponent } from './pdf-viewer.component';

describe('PdfViewerComponent', () => {
  let component: PdfViewerComponent;
  let fixture: ComponentFixture<PdfViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PdfViewerComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(PdfViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should have requiresAcknowledgement false by default', () => {
    expect(component.requiresAcknowledgement).toBe(false);
    expect(component.acknowledgementChecked).toBe(false);
  });

  it('should not show acknowledgement footer when requiresAcknowledgement is false', () => {
    component.open('https://storage.supabase.com/test.pdf', false);
    fixture.detectChanges();

    const ackCheck = document.body.querySelector('#ack-check');
    expect(ackCheck).toBeNull();
  });

  it('should show acknowledgement footer when requiresAcknowledgement is true', () => {
    component.open('https://storage.supabase.com/test.pdf', true);
    fixture.detectChanges();

    const ackCheck = document.body.querySelector('#ack-check');
    expect(ackCheck).not.toBeNull();
    expect(document.body.textContent).toContain(
      'Declaro haber leído y comprendido las directrices de este documento.',
    );
  });

  it('should disable confirm button when acknowledgementChecked is false', () => {
    component.open('https://storage.supabase.com/test.pdf', true);
    component.acknowledgementChecked = false;
    fixture.detectChanges();

    const confirmButton = document.body.querySelector(
      'button[label="Confirmar lectura"]',
    ) as HTMLButtonElement;
    expect(confirmButton?.disabled).toBe(true);
  });

  it('should enable confirm button and emit acknowledge on confirmAcknowledgement when checked', () => {
    const acknowledgeSpy = vi.spyOn(component.acknowledge, 'emit');
    const closeSpy = vi.spyOn(component, 'close');

    component.acknowledgementChecked = true;
    component.confirmAcknowledgement();

    expect(acknowledgeSpy).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
    expect(component.visible).toBe(false);
  });

  it('should not emit acknowledge if confirmAcknowledgement is called when acknowledgementChecked is false', () => {
    const acknowledgeSpy = vi.spyOn(component.acknowledge, 'emit');

    component.acknowledgementChecked = false;
    component.confirmAcknowledgement();

    expect(acknowledgeSpy).not.toHaveBeenCalled();
  });
});