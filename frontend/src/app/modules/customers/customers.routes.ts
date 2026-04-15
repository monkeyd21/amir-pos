import { Routes } from '@angular/router';
import { CustomerListComponent } from './customer-list.component';
import { CustomerDetailComponent } from './customer-detail.component';
import { CustomerFormComponent } from './customer-form.component';

export const CUSTOMERS_ROUTES: Routes = [
  { path: '', component: CustomerListComponent },
  { path: 'new', component: CustomerFormComponent },
  { path: ':id/edit', component: CustomerFormComponent },
  { path: ':id', component: CustomerDetailComponent },
];
