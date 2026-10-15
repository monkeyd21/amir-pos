import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { StockListComponent } from './stock-list.component';

export const DASHBOARD_ROUTES: Routes = [
  { path: '', component: DashboardComponent },
  // §15.6 interim stock list behind the weekly reminder's "View report →".
  { path: 'stock', component: StockListComponent },
];
