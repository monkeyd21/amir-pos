import { Routes } from '@angular/router';
import { ExpenseListComponent } from './expense-list.component';
import { ExpenseFormComponent } from './expense-form.component';
import { CategoryManagementComponent } from './category-management.component';

export const EXPENSES_ROUTES: Routes = [
  { path: '', component: ExpenseListComponent },
  { path: 'add', component: ExpenseFormComponent },
  { path: 'edit/:id', component: ExpenseFormComponent },
  { path: 'categories', component: CategoryManagementComponent },
];
