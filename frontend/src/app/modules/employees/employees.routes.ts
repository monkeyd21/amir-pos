import { Routes } from '@angular/router';
import { EmployeeListComponent } from './employee-list.component';
import { EmployeeFormComponent } from './employee-form.component';
import { AttendanceComponent } from './attendance.component';
import { CommissionsComponent } from './commissions.component';
import { PayrollListComponent } from './payroll-list.component';
import { PayrollDetailComponent } from './payroll-detail.component';

export const EMPLOYEES_ROUTES: Routes = [
  { path: '', component: EmployeeListComponent },
  // Static segments MUST stay above the parameterised :id route.
  { path: 'new', component: EmployeeFormComponent },
  { path: 'attendance', component: AttendanceComponent },
  { path: 'payroll', component: PayrollListComponent },
  { path: 'payroll/:id/:month', component: PayrollDetailComponent },
  { path: 'commissions', component: CommissionsComponent },
  { path: ':id/edit', component: EmployeeFormComponent },
];
