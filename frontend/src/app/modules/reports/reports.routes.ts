import { Routes } from '@angular/router';
import { PlaceholderComponent } from '../placeholder.component';

export const REPORTS_ROUTES: Routes = [
  { path: '', component: PlaceholderComponent, data: { title: 'Reports', icon: 'assessment' } },
];
