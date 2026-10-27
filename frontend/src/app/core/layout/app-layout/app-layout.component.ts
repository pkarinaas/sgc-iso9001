import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../services/auth.service';

/**
 * AppLayoutComponent serves as the primary application layout for authenticated views.
 * It provides a collapsible lateral sidebar with navigation and session controls,
 * and a dynamic main content area hosting the routed views via RouterOutlet.
 */
@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-layout.component.html',
  styleUrl: './app-layout.component.css',
})
export class AppLayoutComponent {
  private readonly authService = inject(AuthService);

  /** Controls whether the left sidebar is visible or collapsed. */
  readonly isSidebarVisible = signal(true);

  /**
   * Toggles the left sidebar visibility.
   */
  toggleSidebar(): void {
    this.isSidebarVisible.update((visible) => !visible);
  }

  /**
   * Signs the current user out and redirects to the login view.
   */
  async onLogout(): Promise<void> {
    await this.authService.signOut();
  }
}