import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TopbarComponent } from './topbar.component';
import { AuthService } from '../../services/auth.service';
import type { User } from '../../models/user.model';

describe('TopbarComponent', () => {
  let component: TopbarComponent;
  let fixture: ComponentFixture<TopbarComponent>;

  const mockUser: User = {
    id: 'usr-456',
    email: 'jperez@empresa.com',
    full_name: 'Juan Pérez',
    role_id: 1,
    is_active: true,
    created_at: new Date().toISOString(),
    roles: {
      id: 1,
      name: 'ADMIN',
      description: 'Administrador del sistema',
      created_at: new Date().toISOString(),
    },
  };

  let authServiceMock: {
    getCurrentUserProfile: ReturnType<typeof vi.fn>;
    userRole: ReturnType<typeof signal<string | null>>;
    currentUser: ReturnType<typeof signal<User | null>>;
  };

  beforeEach(async () => {
    authServiceMock = {
      getCurrentUserProfile: vi.fn().mockResolvedValue({ ...mockUser }),
      userRole: signal('ADMIN'),
      currentUser: signal({ ...mockUser }),
    };

    await TestBed.configureTestingModule({
      imports: [TopbarComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TopbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the topbar component', () => {
    expect(component).toBeTruthy();
  });

  describe('User profile and role display (Instructions 2 & 3)', () => {
    it('should display the logged-in user name and Spanish role in topbar', async () => {
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const profileText = compiled.querySelector('.user-profile-text');
      expect(profileText).toBeTruthy();
      expect(profileText?.textContent).toContain('Juan Pérez');
      expect(profileText?.textContent).toContain('Administrador');
      expect(profileText?.textContent).toContain('|');
    });

    it('should translate different role codes into Spanish properly', () => {
      expect(component.getRoleLabel('ADMIN')).toBe('Administrador');
      expect(component.getRoleLabel('APPROVER')).toBe('Aprobador');
      expect(component.getRoleLabel('REVIEWER')).toBe('Revisor');
      expect(component.getRoleLabel('EDITOR')).toBe('Editor');
      expect(component.getRoleLabel('VIEWER')).toBe('Lector');
      expect(component.getRoleLabel(null)).toBe('Usuario');
      expect(component.getRoleLabel(undefined)).toBe('Usuario');
      expect(component.getRoleLabel('CUSTOM')).toBe('CUSTOM');
    });

    it('should fallback gracefully to "Usuario" when no user profile is available', async () => {
      authServiceMock.currentUser.set(null);
      authServiceMock.userRole.set(null);
      authServiceMock.getCurrentUserProfile.mockResolvedValueOnce(null);
      component.currentUser.set(null);
      fixture.detectChanges();

      expect(component.userName()).toBe('Usuario');
      expect(component.userRole()).toBe('Usuario');

      const compiled = fixture.nativeElement as HTMLElement;
      const profileText = compiled.querySelector('.user-profile-text');
      expect(profileText?.textContent).toContain('Usuario');
    });
  });

  describe('Action buttons (Instruction 3)', () => {
    it('should render the notifications button with pi-bell icon', () => {
      const bellBtn = fixture.nativeElement.querySelector('#btn-notifications') as HTMLButtonElement;
      expect(bellBtn).toBeTruthy();
      expect(bellBtn.classList.contains('p-button-rounded')).toBe(true);
      expect(bellBtn.classList.contains('p-button-text')).toBe(true);

      const bellIcon = bellBtn.querySelector('.pi.pi-bell');
      expect(bellIcon).toBeTruthy();
    });

    it('should emit notifications event when bell button is clicked', () => {
      const notificationsSpy = vi.spyOn(component.notifications, 'emit');
      const bellBtn = fixture.nativeElement.querySelector('#btn-notifications') as HTMLButtonElement;
      expect(bellBtn).toBeTruthy();

      bellBtn.click();
      expect(notificationsSpy).toHaveBeenCalledOnce();
    });

    it('should render the help button with pi-question-circle icon', () => {
      const helpBtn = fixture.nativeElement.querySelector('#btn-help') as HTMLButtonElement;
      expect(helpBtn).toBeTruthy();
      expect(helpBtn.classList.contains('p-button-rounded')).toBe(true);
      expect(helpBtn.classList.contains('p-button-text')).toBe(true);

      const helpIcon = helpBtn.querySelector('.pi.pi-question-circle');
      expect(helpIcon).toBeTruthy();
    });

    it('should emit help event when help button is clicked', () => {
      const helpSpy = vi.spyOn(component.help, 'emit');
      const helpBtn = fixture.nativeElement.querySelector('#btn-help') as HTMLButtonElement;
      expect(helpBtn).toBeTruthy();

      helpBtn.click();
      expect(helpSpy).toHaveBeenCalledOnce();
    });
  });

  describe('Sidebar toggle integration (Instruction 4)', () => {
    it('should not display #btn-open-sidebar when isSidebarVisible is true', () => {
      fixture.componentRef.setInput('isSidebarVisible', true);
      fixture.detectChanges();

      const openBtn = fixture.nativeElement.querySelector('#btn-open-sidebar');
      expect(openBtn).toBeNull();
    });

    it('should display #btn-open-sidebar when isSidebarVisible is false', () => {
      fixture.componentRef.setInput('isSidebarVisible', false);
      fixture.detectChanges();

      const openBtn = fixture.nativeElement.querySelector('#btn-open-sidebar') as HTMLButtonElement;
      expect(openBtn).toBeTruthy();
    });

    it('should emit toggleSidebar when #btn-open-sidebar is clicked', () => {
      fixture.componentRef.setInput('isSidebarVisible', false);
      fixture.detectChanges();

      const toggleSpy = vi.spyOn(component.toggleSidebar, 'emit');
      const openBtn = fixture.nativeElement.querySelector('#btn-open-sidebar') as HTMLButtonElement;
      expect(openBtn).toBeTruthy();

      openBtn.click();
      expect(toggleSpy).toHaveBeenCalledOnce();
    });
  });
});