import { Routes } from '@angular/router';
import { OffersListComponent } from './offers-list.component';
import { OfferDetailComponent } from './offer-detail.component';

export const OFFERS_ROUTES: Routes = [
  { path: '', component: OffersListComponent },
  { path: 'new', component: OfferDetailComponent },
  { path: ':id', component: OfferDetailComponent },
];
