import { Routes } from '@angular/router';
import { VendorListComponent } from './vendor-list.component';
import { VendorDetailComponent } from './vendor-detail.component';

export const VENDORS_ROUTES: Routes = [
  { path: '', component: VendorListComponent },
  { path: ':id', component: VendorDetailComponent },
];
