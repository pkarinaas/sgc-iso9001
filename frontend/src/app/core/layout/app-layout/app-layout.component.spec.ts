import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppLayoutComponent } from './app-layout.component';
import { AuthService } from '../../services/auth.service';

describe('AppLayoutComponent', () => {
  let fixture: ComponentFixture<AppLayoutComponent>;
  let component: AppLayoutComponent;
  let authServiceMock: { signOut: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authServiceMock = {
      signOut: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [AppLayoutComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: authServiceMock,
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

  it('should call authService.signOut() when clicking logout button', async () => {
    const logoutBtn = fixture.nativeElement.querySelector('#btn-logout') as HTMLButtonElement;
    expect(logoutBtn).toBeTruthy();

    logoutBtn.click();
    await fixture.whenStable();

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

    const toggleBtn = fixture.nativeElement.querySelector('#btn-toggle-sidebar') as HTMLButtonElement;
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
