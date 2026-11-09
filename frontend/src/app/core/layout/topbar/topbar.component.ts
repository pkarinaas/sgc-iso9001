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
import { CommonModule } from '@angular/common';
import { ButtonDirective } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { AuthService } from '../../services/auth.service';
import type { User } from '../../models/user.model';

/**
 * TopbarComponent provides the global header bar for authenticated views.
 * It sits at the top of the main layout, displaying the current user's profile
 * information (name and role translated into Spanish), a notification bell icon,
 * a help/tutorial icon, and a responsive toggle to restore the sidebar when collapsed.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, ButtonDirective, Tooltip],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.css',
})
export class TopbarComponent implements OnInit {
  readonly authService = inject(AuthService);
  private readonly cdr = inject(ChangeDetectorRef);

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

  /** Derived Spanish label for the current user's role. */
  readonly userRole = computed(() => {
    const user = this.currentUser();
    const rawRole =
      user?.roles?.name ??
      (Array.isArray(user?.roles) ? (user.roles as any)[0]?.name : null) ??
      (typeof this.authService.userRole === 'function' ? this.authService.userRole() : null);

    return this.getRoleLabel(rawRole);
  });

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
    const labels: Record<string, string> = {
      ADMIN: 'Administrador',
      APPROVER: 'Aprobador',
      REVIEWER: 'Revisor',
      EDITOR: 'Editor',
      VIEWER: 'Lector',
    };
    return labels[roleName ?? ''] ?? roleName ?? 'Usuario';
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
   * Emits the help click event.
   */
  onHelpClick(): void {
    this.help.emit();
  }
}

