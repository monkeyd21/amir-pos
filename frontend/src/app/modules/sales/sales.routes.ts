import { Routes } from '@angular/router';
import { SalesListComponent } from './sales-list.component';
import { SaleDetailComponent } from './sale-detail.component';
import { BillCustomerEditComponent } from './bill-customer-edit.component';

export const SALES_ROUTES: Routes = [
  { path: '', component: SalesListComponent },
  // bug5 — static segment must precede ':id' or "edit-customer" would be
  // matched as a sale id. Registered as its own page, not a dialog.
  { path: ':id/edit-customer', component: BillCustomerEditComponent },
  { path: ':id', component: SaleDetailComponent },
];
