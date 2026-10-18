import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

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
    redirectTo: 'admin/users',
    pathMatch: 'full',
  },
  {
    path: 'admin/users',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/users/user-list/user-list').then((m) => m.UserListComponent),
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
