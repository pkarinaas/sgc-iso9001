import { Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { Select } from 'primeng/select';
import { ButtonDirective } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { PasswordModule } from 'primeng/password';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
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
  providers: [MessageService, ConfirmationService],
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    TagModule,
    Select,
    ButtonDirective,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    DialogModule,
    ToastModule,
    PasswordModule,
    ConfirmDialog,
  ],
})
export class UserListComponent implements OnInit {
  readonly userService = inject(UserService);
  private readonly fb = inject(FormBuilder);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  /** Reference to the p-table instance for programmatic filter resets. */
  @ViewChild('usersTable') usersTable!: Table;

  // Dialog state signals

  /** Controls the visibility of the create/edit dialog. */
  isDialogVisible = signal(false);

  /** True when the dialog is in edit mode; false for create mode. */
  isEditMode = signal(false);

  /** UUID of the user being edited, or null in create mode. */
  selectedUserId = signal<string | null>(null);

  /** True while the save operation is in-flight (disables the save button). */
  isSaving = signal(false);

  // Reactive form

  /**
   * Shared form for both create and edit flows.
   * Validators for `email` and `password` are toggled programmatically
   * depending on the active mode.
   */
  readonly userForm = this.fb.nonNullable.group({
    full_name: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    password: [''],
    role_id: [null as number | null, Validators.required],
  });

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

  /** Role options for the create/edit form, mapped to Spanish. */
  get formRoleOptions() {
    return this.userService.roles().map((r: Role) => ({
      label: this.getRoleLabel(r.name),
      value: r.id,
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

  // Dialog actions

  /**
   * Opens the dialog in **create** mode.
   * Resets the form, sets password as required, and clears edit state.
   */
  openCreateDialog(): void {
    this.userForm.reset();
    this.userForm.controls.email.enable();

    // Password is required only when creating a new account.
    this.userForm.controls.password.setValidators([Validators.required, Validators.minLength(8)]);
    this.userForm.controls.password.updateValueAndValidity();

    this.isEditMode.set(false);
    this.selectedUserId.set(null);
    this.isDialogVisible.set(true);
  }

  /**
   * Alias for openCreateDialog to trigger creation modal from buttons or tests.
   */
  onCreateUser(): void {
    this.openCreateDialog();
  }

  /**
   * Opens the dialog in **edit** mode pre-populated with the given user's data.
   * Email is disabled.
   * Password field is hidden and its validators are cleared.
   *
   * @param user - The user record to edit.
   */
  openEditDialog(user: User): void {
    this.userForm.reset();

    this.userForm.patchValue({
      full_name: user.full_name,
      email: user.email,
      role_id: user.role_id,
    });

    // Lock the email – it must not be changed after account creation.
    this.userForm.controls.email.disable();

    // Clear password validators; the field is hidden in edit mode.
    this.userForm.controls.password.clearValidators();
    this.userForm.controls.password.updateValueAndValidity();

    this.isEditMode.set(true);
    this.selectedUserId.set(user.id);
    this.isDialogVisible.set(true);
  }

  /** Closes the dialog and resets transient state. */
  closeDialog(): void {
    this.isDialogVisible.set(false);
    this.isEditMode.set(false);
    this.selectedUserId.set(null);
    this.userForm.reset();
  }

  /**
   * Validates the form and delegates to the appropriate service method.
   * Displays a `p-toast` notification on success or failure.
   */
  async saveUser(): Promise<void> {
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);

    const { full_name, email, password, role_id } = this.userForm.getRawValue();
    let result: { error: string | null };

    if (this.isEditMode()) {
      result = await this.userService.updateUser(this.selectedUserId()!, {
        full_name,
        role_id: role_id!,
      });
    } else {
      result = await this.userService.createUser({
        email,
        password,
        full_name,
        role_id: role_id!,
      });
    }

    this.isSaving.set(false);

    if (result.error) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: result.error,
        life: 6000,
      });
    } else {
      this.messageService.add({
        severity: 'success',
        summary: 'Éxito',
        detail: this.isEditMode()
          ? 'Empleado actualizado correctamente.'
          : 'Empleado creado correctamente.',
        life: 4000,
      });
      this.closeDialog();
    }
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

  /**
   * Prompts the administrator for confirmation before toggling a user's active status.
   *
   * @param user - The user row whose status should be toggled.
   */
  onToggleStatus(user: User): void {
    const isActive = user.is_active;

    this.confirmationService.confirm({
      header: isActive ? 'Confirmar Desactivación' : 'Confirmar Activación',
      message: isActive
        ? `¿Está seguro de que desea desactivar la cuenta de ${user.full_name}? El empleado no podrá acceder al sistema.`
        : `¿Está seguro de que desea reactivar la cuenta de ${user.full_name}?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, continuar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: isActive ? 'p-button-danger' : 'p-button-success',
      accept: async () => {
        const result = await this.userService.toggleUserStatus(user.id, user.is_active);

        if (result.error) {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: result.error,
            life: 6000,
          });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Éxito',
            detail: 'Estado actualizado',
            life: 4000,
          });
        }
      },
    });
  }
}
