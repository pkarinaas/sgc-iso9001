import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { AppLayoutComponent } from './core/layout/app-layout/app-layout.component';
import { LoginComponent } from './features/auth/login/login';
import { UserListComponent } from './features/users/user-list/user-list';
import { DocumentListComponent } from './features/documents/document-list/document-list';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
  },
  {
    path: '',
    component: AppLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'users',
        component: UserListComponent,
      },
      {
        path: 'documents',
        component: DocumentListComponent,
      },
      {
        path: '',
        redirectTo: 'documents',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];