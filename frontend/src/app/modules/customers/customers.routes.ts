import { Routes } from '@angular/router';
import { CustomerListComponent } from './customer-list.component';
import { CustomerDetailComponent } from './customer-detail.component';

export const CUSTOMERS_ROUTES: Routes = [
  { path: '', component: CustomerListComponent },
  { path: ':id', component: CustomerDetailComponent },
];
