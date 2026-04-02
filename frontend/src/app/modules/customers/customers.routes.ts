import { Routes } from '@angular/router';
import { PlaceholderComponent } from '../placeholder.component';

export const CUSTOMERS_ROUTES: Routes = [
  { path: '', component: PlaceholderComponent, data: { title: 'Customers', icon: 'people' } },
];
