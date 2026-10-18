import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { Select } from 'primeng/select';
import { ButtonDirective, Button } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { UserService } from '../../../core/services/user.service';
import type { Role, User } from '../../../core/models/user.model';

/** Severity levels accepted by PrimeNG's <p-tag> component. */
type TagSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast';

/** Option shape for the role and status filter dropdowns. */
interface FilterOption<T> {
  label: string;
  value: T;
}

/**
 * UserListComponent displays a filterable, paginated table of laboratory
 * employees sourced from `public.users` via `UserService`.
 *
 * Filter capabilities:
 *  - Global text search on `full_name` and `email`.
 *  - Role dropdown filter.
 *  - Active/Inactive status dropdown filter.
 */
@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.html',
  styleUrl: './user-list.css',
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    TagModule,
    Select,
    ButtonDirective,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
  ],
})
export class UserListComponent implements OnInit {
  readonly userService = inject(UserService);

  /** Reference to the p-table instance for programmatic filter resets. */
  @ViewChild('usersTable') usersTable!: Table;

  // Filter state

  /** Current value of the global text search input. */
  globalFilterValue = '';

  /** Currently selected role filter option (null = show all). */
  selectedRole: string | null = null;

  /** Currently selected status filter option (null = show all). */
  selectedStatus: boolean | null = null;

  // Dropdown option lists

  /** Role options derived from UserService signals after loadRoles(). */
  get roleOptions(): FilterOption<string>[] {
    return this.userService.roles().map((r: Role) => ({
      label: this.getRoleLabel(r.name),
      value: r.name,
    }));
  }

  /** Static status options (values map to the is_active boolean column). */
  readonly statusOptions: FilterOption<boolean>[] = [
    { label: 'Activo', value: true },
    { label: 'Inactivo', value: false },
  ];

  // Lifecycle

  async ngOnInit(): Promise<void> {
    // Load roles first (used by the filter dropdown) then users.
    await this.userService.loadRoles();
    await this.userService.loadUsers();
  }

  // Filter helpers

  /** Propagates the global text search value to the p-table's built-in filter. */
  onGlobalFilter(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.globalFilterValue = input.value;
    this.usersTable.filterGlobal(input.value, 'contains');
  }

  /** Applies the role column filter when the dropdown selection changes. */
  onRoleFilterChange(value: string | null): void {
    this.selectedRole = value;
    if (value) {
      this.usersTable.filter(value, 'roles.name', 'equals');
    } else {
      this.usersTable.filter(null, 'roles.name', 'equals');
    }
  }

  /** Applies the status column filter when the dropdown selection changes. */
  onStatusFilterChange(value: boolean | null): void {
    this.selectedStatus = value;
    if (value !== null) {
      this.usersTable.filter(value, 'is_active', 'equals');
    } else {
      this.usersTable.filter(null, 'is_active', 'equals');
    }
  }

  // Display helpers

  /**
   * Returns the PrimeNG Tag severity for a given role name.
   * Colours are chosen to convey authority level at a glance.
   */
  getRoleSeverity(roleName: string | undefined): TagSeverity {
    const map: Record<string, TagSeverity> = {
      ADMIN: 'danger',
      APPROVER: 'warn',
      REVIEWER: 'info',
      EDITOR: 'secondary',
      VIEWER: 'contrast',
    };
    return map[roleName ?? ''] ?? 'secondary';
  }

  /** Maps database role codes to their Spanish UI labels. */
  getRoleLabel(roleName: string | undefined): string {
    const labels: Record<string, string> = {
      ADMIN: 'Administrador',
      APPROVER: 'Aprobador',
      REVIEWER: 'Revisor',
      EDITOR: 'Editor',
      VIEWER: 'Lector',
    };
    return labels[roleName ?? ''] ?? roleName ?? '—';
  }

  // Action stubs

  /**
   * Opens the create-user dialog.
   */
  onCreateUser(): void {
    // TODO: open create-user dialog.
  }

  /**
   * Triggers the edit flow for the selected user.
   *
   * @param user - The user row to edit.
   */
  onEditUser(user: User): void {
    this.userService.editUser(user);
  }

  /**
   * Toggles the active/inactive status of a user.
   *
   * @param user - The user row whose status should be toggled.
   */
  onToggleStatus(user: User): void {
    this.userService.toggleUserStatus(user);
  }
}
