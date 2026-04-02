import { Routes } from '@angular/router';
import { PlaceholderComponent } from '../placeholder.component';

export const SALES_ROUTES: Routes = [
  { path: '', component: PlaceholderComponent, data: { title: 'Sales', icon: 'receipt_long' } },
];
