import { Routes } from '@angular/router';
import { SalesListComponent } from './sales-list.component';
import { SaleDetailComponent } from './sale-detail.component';

export const SALES_ROUTES: Routes = [
  { path: '', component: SalesListComponent },
  { path: ':id', component: SaleDetailComponent },
];
