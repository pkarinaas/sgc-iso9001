import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { ButtonDirective } from 'primeng/button';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { InactivityService } from '../../services/inactivity.service';

/**
 * AppLayoutComponent serves as the primary application layout for authenticated views.
 * It provides a collapsible lateral sidebar with navigation and session controls,
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
  ],
  templateUrl: './app-layout.component.html',
  styleUrl: './app-layout.component.css',
})
export class AppLayoutComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly inactivityService = inject(InactivityService);

  /** Subscription to the inactivity warning visibility observable. */
  private warningSubscription?: Subscription;

  /** Observable stream indicating whether the inactivity warning modal is visible. */
  readonly isWarningVisible$ = this.inactivityService.isWarningVisible$;

  /** Controls whether the left sidebar is visible or collapsed. */
  readonly isSidebarVisible = signal(true);

  /** Signal reflecting whether the warning dialog is currently visible. */
  readonly isWarningVisible = signal(false);

  ngOnInit(): void {
    this.inactivityService.startMonitoring();

    this.warningSubscription = this.inactivityService.isWarningVisible$.subscribe((visible) => {
      this.isWarningVisible.set(visible);
    });
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
