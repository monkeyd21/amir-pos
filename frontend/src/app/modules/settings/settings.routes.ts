import { Routes } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { ProfileComponent } from './profile/profile.component';
import { LabelDesignerComponent } from './label-designer/label-designer.component';
import { PrintersListComponent } from './printing/printers-list.component';
import { PrinterFormComponent } from './printing/printer-form.component';
import { PrinterDiscoveryComponent } from './printing/printer-discovery.component';

export const SETTINGS_ROUTES: Routes = [
  { path: '', component: SettingsComponent },
  { path: 'profile', component: ProfileComponent },
  { path: 'label-designer', redirectTo: 'printers', pathMatch: 'full' },
  { path: 'printers', component: PrintersListComponent },
  { path: 'printers/new', component: PrinterFormComponent },
  { path: 'printers/discover', component: PrinterDiscoveryComponent },
  { path: 'printers/:id/edit', component: PrinterFormComponent },
  { path: 'printers/:profileId/designer/:templateId', component: LabelDesignerComponent },
];
