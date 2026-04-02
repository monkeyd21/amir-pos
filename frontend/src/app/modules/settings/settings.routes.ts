import { Routes } from '@angular/router';
import { PlaceholderComponent } from '../placeholder.component';

export const SETTINGS_ROUTES: Routes = [
  { path: '', component: PlaceholderComponent, data: { title: 'Settings', icon: 'settings' } },
  { path: 'profile', component: PlaceholderComponent, data: { title: 'Profile', icon: 'person' } },
];
