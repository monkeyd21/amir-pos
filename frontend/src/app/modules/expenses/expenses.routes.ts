import { Routes } from '@angular/router';
import { PlaceholderComponent } from '../placeholder.component';

export const EXPENSES_ROUTES: Routes = [
  { path: '', component: PlaceholderComponent, data: { title: 'Expenses', icon: 'account_balance_wallet' } },
];
