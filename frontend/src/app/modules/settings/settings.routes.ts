import { Routes } from '@angular/router';
import { PlaceholderComponent } from '../placeholder.component';
import { ProfileComponent } from './profile/profile.component';

export const SETTINGS_ROUTES: Routes = [
  { path: '', component: PlaceholderComponent, data: { title: 'Settings', icon: 'settings' } },
  { path: 'profile', component: ProfileComponent },
];
