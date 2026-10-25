import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'dashboard',
    redirectTo: 'documents',
    pathMatch: 'full',
  },
  {
    path: 'admin/users',
    canActivate: [authGuard, roleGuard],
    loadComponent: () =>
      import('./features/users/user-list/user-list').then((m) => m.UserListComponent),
  },
  {
    path: 'documents',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/documents/document-list/document-list').then(
        (m) => m.DocumentListComponent,
      ),
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
