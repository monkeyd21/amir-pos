import { Routes } from '@angular/router';
import { MobilePosShellComponent } from './mobile-pos-shell.component';

export const MOBILE_POS_ROUTES: Routes = [
  {
    path: '',
    component: MobilePosShellComponent,
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      {
        path: 'login',
        loadComponent: () =>
          import('./screens/login.screen').then((m) => m.MobileLoginScreen),
      },
      {
        path: 'home',
        loadComponent: () =>
          import('./screens/home.screen').then((m) => m.MobileHomeScreen),
      },
      {
        path: 'cart',
        loadComponent: () =>
          import('./screens/cart.screen').then((m) => m.MobileCartScreen),
      },
      {
        path: 'bill',
        loadComponent: () =>
          import('./screens/bill.screen').then((m) => m.MobileBillScreen),
      },
      {
        path: 'checkout',
        loadComponent: () =>
          import('./screens/checkout.screen').then((m) => m.MobileCheckoutScreen),
      },
      {
        path: 'success',
        loadComponent: () =>
          import('./screens/success.screen').then((m) => m.MobileSuccessScreen),
      },
      {
        path: 'customer',
        loadComponent: () =>
          import('./screens/customer.screen').then((m) => m.MobileCustomerScreen),
      },
      {
        path: 'sales',
        loadComponent: () =>
          import('./screens/sales-list.screen').then((m) => m.MobileSalesListScreen),
      },
      {
        path: 'sales/:id',
        loadComponent: () =>
          import('./screens/sale-detail.screen').then((m) => m.MobileSaleDetailScreen),
      },
      {
        path: 'sales/:id/return',
        loadComponent: () =>
          import('./screens/return.screen').then((m) => m.MobileReturnScreen),
      },
      {
        path: 'sales/:id/exchange',
        loadComponent: () =>
          import('./screens/exchange.screen').then((m) => m.MobileExchangeScreen),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./screens/profile.screen').then((m) => m.MobileProfileScreen),
      },
    ],
  },
];
