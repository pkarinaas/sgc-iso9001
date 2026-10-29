import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject } from 'rxjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppLayoutComponent } from './app-layout.component';
import { AuthService } from '../../services/auth.service';
import { InactivityService } from '../../services/inactivity.service';

describe('AppLayoutComponent', () => {
  let fixture: ComponentFixture<AppLayoutComponent>;
  let component: AppLayoutComponent;
  let authServiceMock: { signOut: ReturnType<typeof vi.fn> };
  let warningSubject: BehaviorSubject<boolean>;
  let inactivityServiceMock: {
    isWarningVisible$: BehaviorSubject<boolean>;
    startMonitoring: ReturnType<typeof vi.fn>;
    stopMonitoring: ReturnType<typeof vi.fn>;
    extendSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    warningSubject = new BehaviorSubject<boolean>(false);

    authServiceMock = {
      signOut: vi.fn().mockResolvedValue(undefined),
    };

    inactivityServiceMock = {
      isWarningVisible$: warningSubject,
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      extendSession: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AppLayoutComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
        {
          provide: InactivityService,
          useValue: inactivityServiceMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the layout component', () => {
    expect(component).toBeTruthy();
  });

  it('should start inactivity monitoring on ngOnInit', () => {
    expect(inactivityServiceMock.startMonitoring).toHaveBeenCalledOnce();
  });

  it('should stop inactivity monitoring and unsubscribe on ngOnDestroy', () => {
    component.ngOnDestroy();
    expect(inactivityServiceMock.stopMonitoring).toHaveBeenCalledOnce();
  });

  it('should update isWarningVisible when isWarningVisible$ emits', () => {
    expect(component.isWarningVisible()).toBe(false);

    warningSubject.next(true);
    fixture.detectChanges();

    expect(component.isWarningVisible()).toBe(true);
  });

  it('should call extendSession() when clicking continue button in warning modal', () => {
    warningSubject.next(true);
    fixture.detectChanges();

    component.onExtendSession();
    expect(inactivityServiceMock.extendSession).toHaveBeenCalledOnce();
  });

  it('should render the footer button in the warning dialog and extend session on click', () => {
    warningSubject.next(true);
    fixture.detectChanges();

    const button = (document.querySelector('#btn-extend-session') ||
      fixture.nativeElement.querySelector('#btn-extend-session')) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain('Extender Sesión');

    button.click();
    expect(inactivityServiceMock.extendSession).toHaveBeenCalledOnce();
  });

  it('should render brand logo text SGC-ISO9001', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const headerTitle = compiled.querySelector('aside .text-2xl');
    expect(headerTitle?.textContent?.trim()).toBe('SGC-ISO9001');
  });

  it('should render navigation links for users and documents', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const links = compiled.querySelectorAll('aside nav a');
    expect(links.length).toBe(2);

    const userLink = Array.from(links).find((link) => link.getAttribute('routerLink') === '/users');
    const docLink = Array.from(links).find(
      (link) => link.getAttribute('routerLink') === '/documents',
    );

    expect(userLink).toBeTruthy();
    expect(userLink?.textContent).toContain('Usuarios');
    expect(userLink?.querySelector('.pi.pi-users')).toBeTruthy();

    expect(docLink).toBeTruthy();
    expect(docLink?.textContent).toContain('Repositorio');
    expect(docLink?.querySelector('.pi.pi-folder')).toBeTruthy();
  });

  it('should call authService.signOut() and stop monitoring when clicking logout button', async () => {
    const logoutBtn = fixture.nativeElement.querySelector('#btn-logout') as HTMLButtonElement;
    expect(logoutBtn).toBeTruthy();

    logoutBtn.click();
    await fixture.whenStable();

    expect(inactivityServiceMock.stopMonitoring).toHaveBeenCalled();
    expect(authServiceMock.signOut).toHaveBeenCalledOnce();
  });

  it('should render router-outlet inside main container', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const mainEl = compiled.querySelector('main');
    expect(mainEl).toBeTruthy();
    expect(mainEl?.querySelector('router-outlet')).toBeTruthy();
  });

  it('should toggle sidebar visibility when toggle button is clicked', () => {
    expect(component.isSidebarVisible()).toBe(true);

    const toggleBtn = fixture.nativeElement.querySelector(
      '#btn-toggle-sidebar',
    ) as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();

    toggleBtn.click();
    fixture.detectChanges();

    expect(component.isSidebarVisible()).toBe(false);
    const aside = fixture.nativeElement.querySelector('aside');
    expect(aside.classList.contains('sidebar--hidden')).toBe(true);

    const openBtn = fixture.nativeElement.querySelector('#btn-open-sidebar') as HTMLButtonElement;
    expect(openBtn).toBeTruthy();

    openBtn.click();
    fixture.detectChanges();

    expect(component.isSidebarVisible()).toBe(true);
    expect(aside.classList.contains('sidebar--hidden')).toBe(false);
  });
});
