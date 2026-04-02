import { Routes } from '@angular/router';
import { PlaceholderComponent } from '../placeholder.component';

export const EMPLOYEES_ROUTES: Routes = [
  { path: '', component: PlaceholderComponent, data: { title: 'Employees', icon: 'badge' } },
];
