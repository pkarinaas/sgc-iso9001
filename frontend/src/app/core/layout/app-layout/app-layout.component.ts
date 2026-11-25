import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { ButtonDirective } from 'primeng/button';
import { Subscription } from 'rxjs';
import { TopbarComponent } from '../topbar/topbar.component';
import { AuthService } from '../../services/auth.service';
import { InactivityService } from '../../services/inactivity.service';
import { extractRoleNames } from '../../models/user.model';

/**
 * AppLayoutComponent serves as the primary application layout for authenticated views.
 * It provides a collapsible lateral sidebar with navigation and session controls,
 * a global Topbar hosting user profile info and header actions,
 * a dynamic main content area hosting the routed views via RouterOutlet,
 * and an inactivity warning modal dialog to prevent unexpected session terminations.
 */
@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    DialogModule,
    ButtonDirective,
    TopbarComponent,
  ],
  templateUrl: './app-layout.component.html',
  styleUrl: './app-layout.component.css',
})
export class AppLayoutComponent implements OnInit, OnDestroy {
  readonly authService = inject(AuthService);
  private readonly inactivityService = inject(InactivityService);

  /** Subscription to the inactivity warning visibility observable. */
  private warningSubscription?: Subscription;

  /** Observable stream indicating whether the inactivity warning modal is visible. */
  readonly isWarningVisible$ = this.inactivityService.isWarningVisible$;

  /** Controls whether the left sidebar is visible or collapsed. */
  readonly isSidebarVisible = signal(true);

  /** Signal reflecting whether the warning dialog is currently visible. */
  readonly isWarningVisible = signal(false);

  /** Signal holding all active role codes assigned to the current user. */
  readonly userRoles = signal<string[]>([]);

  /**
   * Indicates whether the currently authenticated user holds the Administrator role.
   * Restricts sensitive navigation elements such as the "Usuarios" view.
   */
  get isAdmin(): boolean {
    if (this.userRoles().length > 0) {
      return this.userRoles().includes('ADMIN');
    }

    if (typeof this.authService.hasRole === 'function') {
      return this.authService.hasRole('ADMIN');
    }

    const current =
      typeof this.authService.currentUser === 'function' ? this.authService.currentUser() : null;
    return extractRoleNames(current).includes('ADMIN');
  }

  async ngOnInit(): Promise<void> {
    this.inactivityService.startMonitoring();

    this.warningSubscription = this.inactivityService.isWarningVisible$.subscribe((visible) => {
      this.isWarningVisible.set(visible);
    });

    await this.loadUserRole();
  }

  /**
   * Retrieves the current user's roles from AuthService.
   */
  async loadUserRole(): Promise<void> {
    if (typeof this.authService.userRoles === 'function' && this.authService.userRoles().length > 0) {
      this.userRoles.set(this.authService.userRoles());
      return;
    }

    if (typeof this.authService.getUserRoles === 'function') {
      try {
        const roles = await this.authService.getUserRoles();
        if (roles.length > 0) {
          this.userRoles.set(roles);
        }
      } catch (error) {
        console.error('Error fetching user roles in AppLayoutComponent:', error);
      }
      return;
    }

    if (typeof this.authService.getUserRole === 'function') {
      try {
        const role = await this.authService.getUserRole();
        if (role) {
          this.userRoles.set([role]);
        }
      } catch (error) {
        console.error('Error fetching user role in AppLayoutComponent:', error);
      }
    }
  }

  ngOnDestroy(): void {
    this.warningSubscription?.unsubscribe();
    this.inactivityService.stopMonitoring();
  }

  /**
   * Toggles the left sidebar visibility.
   */
  toggleSidebar(): void {
    this.isSidebarVisible.update((visible) => !visible);
  }

  /**
   * Extends the session and dismisses the warning modal when the user clicks continue.
   */
  extendSession(): void {
    this.inactivityService.extendSession();
  }

  /**
   * Alias for extendSession for backward compatibility.
   */
  onExtendSession(): void {
    this.extendSession();
  }

  /**
   * Signs the current user out and redirects to the login view.
   */
  async onLogout(): Promise<void> {
    this.inactivityService.stopMonitoring();
    await this.authService.signOut();
  }
}
