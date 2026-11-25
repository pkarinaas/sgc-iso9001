import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MessageService, ConfirmationService } from 'primeng/api';
import { Table } from 'primeng/table';
import { UserListComponent } from './user-list';
import { UserService } from '../../../core/services/user.service';
import type { Role, User } from '../../../core/models/user.model';

describe('UserListComponent', () => {
  let component: UserListComponent;
  let fixture: ComponentFixture<UserListComponent>;

  const mockRoles: Role[] = [
    {
      id: 1,
      name: 'ADMIN',
      description: 'Administrator role',
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      name: 'EDITOR',
      description: 'Editor role',
      created_at: new Date().toISOString(),
    },
    {
      id: 3,
      name: 'REVIEWER',
      description: 'Reviewer role',
      created_at: new Date().toISOString(),
    },
    {
      id: 4,
      name: 'APPROVER',
      description: 'Approver role',
      created_at: new Date().toISOString(),
    },
  ];

  const mockUsers: User[] = [
    {
      id: 'usr-1',
      email: 'admin@empresa.com',
      full_name: 'Admin User',
      role_id: 1,
      is_active: true,
      created_at: new Date().toISOString(),
      roles: mockRoles[0],
      user_roles: [{ role_id: 1, roles: { id: 1, name: 'ADMIN' } }],
      roleNames: ['ADMIN'],
    },
    {
      id: 'usr-2',
      email: 'multi@empresa.com',
      full_name: 'María Multi',
      role_id: 4,
      is_active: true,
      created_at: new Date().toISOString(),
      roles: mockRoles[3],
      user_roles: [
        { role_id: 3, roles: { id: 3, name: 'REVIEWER' } },
        { role_id: 4, roles: { id: 4, name: 'APPROVER' } },
      ],
      roleNames: ['APPROVER', 'REVIEWER'],
    },
  ];

  const mockUserService = {
    roles: signal<Role[]>(mockRoles),
    users: signal<User[]>(mockUsers),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    loadRoles: vi.fn().mockResolvedValue(undefined),
    loadUsers: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    toggleUserStatus: vi.fn().mockResolvedValue({ error: null }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUserService.users.set([...mockUsers]);
    mockUserService.roles.set([...mockRoles]);
    await TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        ConfirmationService,
        { provide: UserService, useValue: mockUserService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should translate role names correctly', () => {
    expect(component.getRoleLabel('ADMIN')).toBe('Administrador');
    expect(component.getRoleLabel('EDITOR')).toBe('Editor');
    expect(component.getRoleLabel('REVIEWER')).toBe('Revisor');
    expect(component.getRoleLabel('APPROVER')).toBe('Aprobador');
    expect(component.getRoleLabel('VIEWER')).toBe('Lector');
    expect(component.getRoleLabel(undefined)).toBe('—');
  });

  it('should open create dialog when onCreateUser is called', () => {
    component.onCreateUser();

    expect(component.isDialogVisible()).toBe(true);
    expect(component.isEditMode()).toBe(false);
    expect(component.selectedUserId()).toBeNull();
  });

  it('should correctly apply global filter', () => {
    if (!component.usersTable) {
      component.usersTable = { filterGlobal: vi.fn() } as unknown as Table;
    } else {
      vi.spyOn(component.usersTable, 'filterGlobal').mockImplementation(() => undefined);
    }

    const mockEvent = {
      target: { value: 'Admin' },
    } as unknown as Event;

    component.onGlobalFilter(mockEvent);

    expect(component.globalFilterValue).toBe('Admin');
    expect(component.usersTable.filterGlobal).toHaveBeenCalledWith('Admin', 'contains');
  });

  it('should require at least one role selected and disable save button when role_ids is empty', () => {
    component.openCreateDialog();
    fixture.detectChanges();

    expect(component.userForm.invalid).toBe(true);
    const rolesControl = document.querySelector('#select-roles-control');
    expect(rolesControl?.tagName.toLowerCase()).toBe('p-select');
    expect(document.querySelector('p-multiselect')).toBeNull();

    const saveButton = fixture.nativeElement.querySelector('#btn-dialog-save') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    component.userForm.patchValue({
      full_name: 'Carlos Ruiz',
      email: 'carlos@empresa.com',
      password: 'password123',
      role_ids: [],
      assigned_processes: ['quimica_clinica'],
    });
    component.userForm.controls.role_ids.markAsTouched();
    fixture.detectChanges();

    expect(component.userForm.controls.role_ids.invalid).toBe(true);
    expect(saveButton.disabled).toBe(true);
    const errorEl = document.querySelector('.user-form-error');
    expect(errorEl?.textContent).toContain('Debe seleccionar al menos un rol.');

    component.userForm.patchValue({
      role_ids: [1, 3],
    });
    fixture.detectChanges();

    expect(component.userForm.valid).toBe(true);
    expect(saveButton.disabled).toBe(false);
  });

  it('should include multiple role_ids and assigned_processes in payload on saveUser', async () => {
    component.openCreateDialog();
    component.userForm.patchValue({
      full_name: 'Carlos Ruiz',
      email: 'carlos@empresa.com',
      password: 'password123',
      role_ids: [1, 3],
      assigned_processes: ['quimica_clinica', 'hematologia'],
    });

    await component.saveUser();

    expect(mockUserService.createUser).toHaveBeenCalledWith({
      email: 'carlos@empresa.com',
      password: 'password123',
      full_name: 'Carlos Ruiz',
      role_ids: [1, 3],
      assigned_processes: ['quimica_clinica', 'hematologia'],
    });
  });

  it('should pre-populate all user_roles in edit mode and submit updated role_ids on saveUser', async () => {
    const userToEdit: User = {
      id: 'usr-1',
      full_name: 'Ana García',
      email: 'ana@empresa.com',
      role_id: 2,
      is_active: true,
      created_at: new Date().toISOString(),
      assigned_processes: ['bacteriologia', 'guardia'],
      user_roles: [
        { role_id: 2, roles: { id: 2, name: 'EDITOR' } },
        { role_id: 3, roles: { id: 3, name: 'REVIEWER' } },
      ],
    };

    component.openEditDialog(userToEdit);

    expect(component.isEditMode()).toBe(true);
    expect(component.userForm.controls.role_ids.value).toEqual([2, 3]);
    expect(component.userForm.controls.assigned_processes.value).toEqual(['bacteriologia', 'guardia']);

    component.userForm.patchValue({
      role_ids: [3, 4],
      assigned_processes: ['quimica_clinica'],
    });

    await component.saveUser();

    expect(mockUserService.updateUser).toHaveBeenCalledWith('usr-1', {
      full_name: 'Ana García',
      role_ids: [3, 4],
      assigned_processes: ['quimica_clinica'],
    });
  });

  it('should render Roles header with multi-role pills and filter multi-role users by any assigned role', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const headers = Array.from(compiled.querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).toContain('Roles');

    const rows = compiled.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const multiRolePills = rows[1].querySelectorAll('.user-roles-cell .sgc-badge');
    expect(Array.from(multiRolePills).map((p) => p.textContent?.trim())).toEqual([
      'Aprobador',
      'Revisor',
    ]);

    component.onRoleFilterChange('REVIEWER');
    fixture.detectChanges();
    expect(component.filteredUsers().map((u) => u.id)).toEqual(['usr-2']);

    component.onRoleFilterChange(null);
    fixture.detectChanges();
    expect(component.filteredUsers()).toHaveLength(2);
  });
});
