import { Routes } from '@angular/router';
import { ReportsComponent } from './reports.component';
import { VarianceReportComponent } from './variance-report.component';
import { ChildBirthdayReportComponent } from './child-birthday-report.component';
import { PnlReportComponent } from './pnl-report.component';
import { HistoricalSalesReportComponent } from './historical-sales-report.component';

export const REPORTS_ROUTES: Routes = [
  { path: '', component: ReportsComponent },
  // Historical (archive) sales summary.
  { path: 'historical', component: HistoricalSalesReportComponent },
  // §8.4 — Daily/Monthly Variance Report.
  { path: 'variance', component: VarianceReportComponent },
  // §6 — Child Birthdays (Marketing) outreach list.
  { path: 'child-birthdays', component: ChildBirthdayReportComponent },
  // Profit & Loss — default today, date-range + week/month/quarter/year presets.
  { path: 'pnl', component: PnlReportComponent },
];
