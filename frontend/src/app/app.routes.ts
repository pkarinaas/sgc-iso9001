import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { AppLayoutComponent } from './core/layout/app-layout/app-layout.component';
import { LoginComponent } from './features/auth/login/login';
import { UserListComponent } from './features/users/user-list/user-list';
import { DocumentListComponent } from './features/documents/document-list/document-list';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { AuditReportsComponent } from './features/reports/audit-reports/audit-reports.component';

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
        path: 'dashboard',
        component: DashboardComponent,
      },
      {
        path: 'users',
        component: UserListComponent,
      },
      {
        path: 'documents',
        component: DocumentListComponent,
      },
      {
        path: 'reportes',
        component: AuditReportsComponent,
      },
      {
        path: 'auditoria',
        redirectTo: 'reportes',
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];