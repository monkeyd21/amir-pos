import { Routes } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { ProfileComponent } from './profile/profile.component';
import { LabelDesignerComponent } from './label-designer/label-designer.component';

export const SETTINGS_ROUTES: Routes = [
  { path: '', component: SettingsComponent },
  { path: 'profile', component: ProfileComponent },
  { path: 'label-designer', component: LabelDesignerComponent },
];
