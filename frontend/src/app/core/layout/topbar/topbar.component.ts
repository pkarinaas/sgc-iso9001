import {
  ChangeDetectorRef,
  Component,
  computed,
  EventEmitter,
  inject,
  Input,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ButtonDirective } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { PopoverModule } from 'primeng/popover';
import { AuthService } from '../../services/auth.service';
import { NotificationService, type AppNotification } from '../../services/notification.service';
import { extractRoleNames, formatRoleLabel, type User } from '../../models/user.model';

/**
 * TopbarComponent provides the global header bar for authenticated views.
 * It sits at the top of the main layout, displaying the current user's profile
 * information (name and role translated into Spanish), a notification bell icon
 * with a real-time unread badge and popover panel, a help/tutorial icon, and a
 * responsive toggle to restore the sidebar when collapsed.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, DatePipe, ButtonDirective, Tooltip, PopoverModule],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.css',
})
export class TopbarComponent implements OnInit {
  readonly authService = inject(AuthService);
  readonly notificationService = inject(NotificationService);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Expose unread notifications count signal from NotificationService. */
  readonly unreadCount = this.notificationService.unreadCount;

  /** Expose notification list signal from NotificationService. */
  readonly notificationItems = this.notificationService.notifications;

  /** Formatted unread count badge text (caps display at '99+'). */
  readonly formattedUnreadCount = computed(() => {
    const count = this.unreadCount();
    return count > 99 ? '99+' : count.toString();
  });

  /** Indicates whether the layout's sidebar is currently visible. */
  @Input() isSidebarVisible = true;

  /** Emits an event when the user requests to toggle the sidebar. */
  @Output() readonly toggleSidebar = new EventEmitter<void>();

  /** Emits an event when the user clicks the notifications bell button. */
  @Output() readonly notifications = new EventEmitter<void>();

  /** Emits an event when the user clicks the help/tutorial button. */
  @Output() readonly help = new EventEmitter<void>();

  /** Holds the current user's profile data. */
  readonly currentUser = signal<User | null>(null);

  /** True while the user profile data is being loaded. */
  readonly isLoading = signal<boolean>(false);

  /** Derived display name of the current user. */
  readonly userName = computed(() => {
    const user = this.currentUser();
    return user?.full_name?.trim() || 'Usuario';
  });

  /** Derived priority-sorted role codes assigned to the current user. */
  readonly userRoleCodes = computed(() => {
    const profileRoles = extractRoleNames(this.currentUser());
    if (profileRoles.length > 0) {
      return profileRoles;
    }

    if (typeof this.authService.userRoles === 'function' && this.authService.userRoles().length > 0) {
      return this.authService.userRoles();
    }

    const legacyRole =
      typeof this.authService.userRole === 'function' ? this.authService.userRole() : null;
    return legacyRole ? [legacyRole] : [];
  });

  /** Derived Spanish labels for all roles assigned to the current user. */
  readonly userRoleLabels = computed(() =>
    this.userRoleCodes().map((role) => this.getRoleLabel(role)),
  );

  /** Derived Spanish label for the current user's primary role. */
  readonly userRole = computed(() => this.userRoleLabels()[0] ?? 'Usuario');

  /** Number of additional assigned roles beyond the primary display pill. */
  readonly extraRolesCount = computed(() => Math.max(0, this.userRoleLabels().length - 1));

  /** Tooltip listing all assigned roles in Spanish when the user holds multiple roles. */
  readonly allRolesTooltip = computed(() =>
    this.userRoleLabels().length > 1
      ? `Roles asignados: ${this.userRoleLabels().join(', ')}`
      : '',
  );

  async ngOnInit(): Promise<void> {
    await this.loadUserData();
  }

  /**
   * Hydrates the user's profile data from AuthService.
   */
  async loadUserData(): Promise<void> {
    // Check if the signal already holds a loaded user in AuthService
    if (
      this.authService.currentUser &&
      typeof this.authService.currentUser === 'function' &&
      this.authService.currentUser()
    ) {
      this.currentUser.set(this.authService.currentUser());
      return;
    }

    if (typeof this.authService.getCurrentUserProfile === 'function') {
      this.isLoading.set(true);
      try {
        const user = await this.authService.getCurrentUserProfile();
        if (user) {
          this.currentUser.set(user);
        }
      } catch (error) {
        console.error('Error loading user profile in TopbarComponent:', error);
      } finally {
        this.isLoading.set(false);
        this.cdr.markForCheck();
      }
    }
  }

  /**
   * Maps raw database role strings (e.g. 'ADMIN') to Spanish UI labels.
   *
   * @param roleName - The database role identifier.
   * @returns Spanish display label.
   */
  getRoleLabel(roleName: string | undefined | null): string {
    return formatRoleLabel(roleName);
  }

  /**
   * Emits the toggleSidebar event.
   */
  onToggleSidebar(): void {
    this.toggleSidebar.emit();
  }

  /**
   * Emits the notifications click event.
   */
  onNotificationsClick(): void {
    this.notifications.emit();
  }

  /**
   * Marks an unread notification as read when clicked by the user.
   *
   * @param item - The notification item clicked.
   */
  onNotificationItemClick(item: AppNotification): void {
    if (!item.is_read) {
      void this.notificationService.markAsRead(item.id);
    }
  }

  /**
   * Marks all unread notifications as read.
   */
  onMarkAllAsRead(): void {
    void this.notificationService.markAllAsRead();
  }

  /**
   * Emits the help click event.
   */
  onHelpClick(): void {
    this.help.emit();
  }
}

