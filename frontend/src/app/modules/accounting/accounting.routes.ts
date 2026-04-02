import { Routes } from '@angular/router';
import { PlaceholderComponent } from '../placeholder.component';

export const ACCOUNTING_ROUTES: Routes = [
  { path: '', component: PlaceholderComponent, data: { title: 'Accounting', icon: 'calculate' } },
];
