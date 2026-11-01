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
      vi.spyOn(component.usersTable, 'filterGlobal').mockImplementation(() => {});
    }

    const mockEvent = {
      target: { value: 'Admin' },
    } as unknown as Event;

    component.onGlobalFilter(mockEvent);

    expect(component.globalFilterValue).toBe('Admin');
    expect(component.usersTable.filterGlobal).toHaveBeenCalledWith('Admin', 'contains');
  });

  it('should disable the save button when userForm is invalid and enable it when valid', () => {
    component.openCreateDialog();
    fixture.detectChanges();

    expect(component.userForm.invalid).toBe(true);

    const saveButton = fixture.nativeElement.querySelector('#btn-dialog-save') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    component.userForm.patchValue({
      full_name: 'Carlos Ruiz',
      email: 'carlos@empresa.com',
      password: 'password123',
      role_id: 1,
    });
    fixture.detectChanges();

    expect(component.userForm.valid).toBe(true);
    expect(saveButton.disabled).toBe(false);
  });
});
