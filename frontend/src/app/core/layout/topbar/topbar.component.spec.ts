import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computed, signal } from '@angular/core';
import { TopbarComponent } from './topbar.component';
import { AuthService } from '../../services/auth.service';
import { NotificationService, type AppNotification } from '../../services/notification.service';
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

  let notificationServiceMock: {
    notifications: ReturnType<typeof signal<AppNotification[]>>;
    unreadCount: ReturnType<typeof computed<number>>;
    markAsRead: ReturnType<typeof vi.fn>;
    markAllAsRead: ReturnType<typeof vi.fn>;
  };

  const makeNotifications = (unread: number, read = 0): AppNotification[] => {
    const items: AppNotification[] = [];
    for (let i = 0; i < unread; i++) {
      items.push({
        id: `unread-${i + 1}`,
        user_id: 'usr-456',
        document_id: i + 1,
        type: 'REVIEW_REQUIRED',
        message: `Notificación sin leer ${i + 1}`,
        is_read: false,
        created_at: '2026-11-18T14:30:00Z',
      });
    }
    for (let j = 0; j < read; j++) {
      items.push({
        id: `read-${j + 1}`,
        user_id: 'usr-456',
        document_id: 100 + j,
        type: 'DOCUMENT_APPROVED',
        message: `Notificación leída ${j + 1}`,
        is_read: true,
        created_at: '2026-11-17T09:15:00Z',
      });
    }
    return items;
  };

  beforeEach(async () => {
    authServiceMock = {
      getCurrentUserProfile: vi.fn().mockResolvedValue({ ...mockUser }),
      userRole: signal('ADMIN'),
      currentUser: signal({ ...mockUser }),
    };

    const notificationsSignal = signal<AppNotification[]>([]);
    notificationServiceMock = {
      notifications: notificationsSignal,
      unreadCount: computed(() => notificationsSignal().filter((n) => !n.is_read).length),
      markAsRead: vi.fn().mockResolvedValue(undefined),
      markAllAsRead: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [TopbarComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
        {
          provide: NotificationService,
          useValue: notificationServiceMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TopbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
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

    describe('Realtime notifications badge', () => {
      it('should not display notification badge when unreadCount is 0', () => {
        notificationServiceMock.notifications.set(makeNotifications(0, 2));
        fixture.detectChanges();

        const badge = fixture.nativeElement.querySelector('#notifications-badge');
        expect(badge).toBeNull();
      });

      it('should render badge as a sibling inside .notification-bell-wrapper for single and double digits', () => {
        notificationServiceMock.notifications.set(makeNotifications(1));
        fixture.detectChanges();

        const wrapper = fixture.nativeElement.querySelector('.notification-bell-wrapper');
        const bellBtn = fixture.nativeElement.querySelector('#btn-notifications') as HTMLButtonElement;
        let badge = wrapper?.querySelector('#notifications-badge') as HTMLElement | null;

        expect(wrapper).toBeTruthy();
        expect(badge).toBeTruthy();
        expect(badge?.textContent?.trim()).toBe('1');
        expect(bellBtn.querySelector('#notifications-badge')).toBeNull();

        notificationServiceMock.notifications.set(makeNotifications(12));
        fixture.detectChanges();

        badge = wrapper?.querySelector('#notifications-badge') as HTMLElement | null;
        expect(badge?.textContent?.trim()).toBe('12');
      });

      it('should cap badge text at 99+ when unreadCount exceeds 99', () => {
        notificationServiceMock.notifications.set(makeNotifications(105));
        fixture.detectChanges();

        const badge = fixture.nativeElement.querySelector('#notifications-badge') as HTMLElement | null;
        expect(badge).toBeTruthy();
        expect(badge?.textContent?.trim()).toBe('99+');
      });

      it('should dynamically hide badge when all notifications become read', () => {
        notificationServiceMock.notifications.set(makeNotifications(1));
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#notifications-badge')).toBeTruthy();

        notificationServiceMock.notifications.set(makeNotifications(0, 1));
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('#notifications-badge')).toBeNull();
      });
    });

    describe('Notifications popover', () => {
      it('should open popover on bell click and render empty state when there are no notifications', async () => {
        const bellBtn = fixture.nativeElement.querySelector('#btn-notifications') as HTMLButtonElement;
        bellBtn.click();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const panel = document.querySelector('.notifications-panel') as HTMLElement | null;
        expect(panel).toBeTruthy();
        expect(panel?.querySelector('.notifications-title')?.textContent?.trim()).toBe(
          'Notificaciones',
        );
        expect(panel?.querySelector('#btn-mark-all-read')).toBeNull();
        expect(panel?.querySelector('.notifications-empty .pi-bell-slash')).toBeTruthy();
        expect(panel?.querySelector('.notifications-empty-text')?.textContent?.trim()).toBe(
          'No tienes notificaciones.',
        );
      });

      it('should render unread and read notifications with formatted timestamps and unread indicators', async () => {
        notificationServiceMock.notifications.set(makeNotifications(1, 1));
        fixture.detectChanges();

        const bellBtn = fixture.nativeElement.querySelector('#btn-notifications') as HTMLButtonElement;
        bellBtn.click();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const panel = document.querySelector('.notifications-panel') as HTMLElement | null;
        expect(panel).toBeTruthy();
        expect(panel?.querySelector('#btn-mark-all-read')?.textContent?.trim()).toBe(
          'Marcar todas como leídas',
        );

        const items = panel?.querySelectorAll('.notification-item') ?? [];
        expect(items.length).toBe(2);

        const unreadItem = items[0] as HTMLElement;
        expect(unreadItem.classList.contains('notification-item--unread')).toBe(true);
        expect(unreadItem.querySelector('.notification-message')?.textContent?.trim()).toBe(
          'Notificación sin leer 1',
        );
        expect(unreadItem.querySelector('.notification-timestamp')?.textContent?.trim()).toMatch(
          /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
        );
        expect(unreadItem.querySelector('.notification-unread-dot')).toBeTruthy();

        const readItem = items[1] as HTMLElement;
        expect(readItem.classList.contains('notification-item--unread')).toBe(false);
        expect(readItem.querySelector('.notification-message')?.textContent?.trim()).toBe(
          'Notificación leída 1',
        );
        expect(readItem.querySelector('.notification-unread-dot')).toBeNull();
      });

      it('should call markAsRead only when clicking an unread notification item', async () => {
        notificationServiceMock.notifications.set(makeNotifications(1, 1));
        fixture.detectChanges();

        const bellBtn = fixture.nativeElement.querySelector('#btn-notifications') as HTMLButtonElement;
        bellBtn.click();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const items = document.querySelectorAll('.notification-item');
        (items[1] as HTMLElement).click();
        expect(notificationServiceMock.markAsRead).not.toHaveBeenCalled();

        (items[0] as HTMLElement).click();
        expect(notificationServiceMock.markAsRead).toHaveBeenCalledWith('unread-1');
      });

      it('should call markAllAsRead when clicking "Marcar todas como leídas"', async () => {
        notificationServiceMock.notifications.set(makeNotifications(2));
        fixture.detectChanges();

        const bellBtn = fixture.nativeElement.querySelector('#btn-notifications') as HTMLButtonElement;
        bellBtn.click();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const markAllBtn = document.querySelector('#btn-mark-all-read') as HTMLButtonElement | null;
        expect(markAllBtn).toBeTruthy();
        markAllBtn?.click();

        expect(notificationServiceMock.markAllAsRead).toHaveBeenCalledOnce();
      });
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