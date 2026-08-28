import { Routes } from '@angular/router';
import { PayablesMonthComponent } from './payables-month.component';
import { PayableFormComponent } from './payable-form.component';
import { CategoryListComponent } from './category-list.component';
import { CategoryFormComponent } from './category-form.component';

// Static segments must be registered before the parameterised ':id', or
// '/expenses/categories' matches as an id.
export const EXPENSES_ROUTES: Routes = [
  { path: '', component: PayablesMonthComponent },
  { path: 'new', component: PayableFormComponent },
  { path: 'categories', component: CategoryListComponent },
  { path: 'categories/new', component: CategoryFormComponent },
  { path: 'categories/:id/edit', component: CategoryFormComponent },
  { path: ':id', component: PayableFormComponent },
];
