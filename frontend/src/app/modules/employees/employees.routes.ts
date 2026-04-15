import { Routes } from '@angular/router';
import { EmployeeListComponent } from './employee-list.component';
import { EmployeeFormComponent } from './employee-form.component';
import { AttendanceComponent } from './attendance.component';
import { CommissionsComponent } from './commissions.component';

export const EMPLOYEES_ROUTES: Routes = [
  { path: '', component: EmployeeListComponent },
  { path: 'new', component: EmployeeFormComponent },
  { path: ':id/edit', component: EmployeeFormComponent },
  { path: 'attendance', component: AttendanceComponent },
  { path: 'commissions', component: CommissionsComponent },
];
