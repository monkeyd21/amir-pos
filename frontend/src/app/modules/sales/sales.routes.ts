import { Routes } from '@angular/router';
import { SalesListComponent } from './sales-list.component';
import { SaleDetailComponent } from './sale-detail.component';
import { BillEditComponent } from './bill-edit.component';

export const SALES_ROUTES: Routes = [
  { path: '', component: SalesListComponent },
  { path: ':id/edit', component: BillEditComponent },
  { path: ':id', component: SaleDetailComponent },
];
