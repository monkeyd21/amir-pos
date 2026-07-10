import { Routes } from '@angular/router';
import { ReportsComponent } from './reports.component';
import { VarianceReportComponent } from './variance-report.component';

export const REPORTS_ROUTES: Routes = [
  { path: '', component: ReportsComponent },
  // §8.4 — Daily/Monthly Variance Report.
  { path: 'variance', component: VarianceReportComponent },
];
