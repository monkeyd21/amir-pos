import { Routes } from '@angular/router';
import { EmployeeListComponent } from './employee-list.component';
import { AttendanceComponent } from './attendance.component';
import { CommissionsComponent } from './commissions.component';

export const EMPLOYEES_ROUTES: Routes = [
  { path: '', component: EmployeeListComponent },
  { path: 'attendance', component: AttendanceComponent },
  { path: 'commissions', component: CommissionsComponent },
];
