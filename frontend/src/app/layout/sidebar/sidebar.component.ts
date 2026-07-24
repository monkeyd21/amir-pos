import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

interface NavItem {
  icon: string;
  label: string;
  path: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
})
export class SidebarComponent {
  private readonly allNav: NavItem[] = [
    { icon: 'dashboard', label: 'Dashboard', path: '/dashboard' },
    { icon: 'point_of_sale', label: 'POS', path: '/pos' },
    { icon: 'inventory_2', label: 'Inventory', path: '/inventory' },
    { icon: 'payments', label: 'Sales', path: '/sales' },
    { icon: 'receipt_long', label: 'Historical', path: '/historical' },
    { icon: 'sell', label: 'Offers', path: '/offers' },
    { icon: 'redeem', label: 'Vouchers', path: '/vouchers' },
    { icon: 'group', label: 'Customers', path: '/customers' },
    { icon: 'store', label: 'Vendors', path: '/vendors' },
    { icon: 'badge', label: 'Employees', path: '/employees' },
    { icon: 'receipt_long', label: 'Expenses', path: '/expenses' },
    { icon: 'account_balance', label: 'Accounting', path: '/accounting' },
    { icon: 'analytics', label: 'Reports', path: '/reports' },
    { icon: 'history', label: 'Audit Log', path: '/audit' },
  ];

  /** Billing staff (cashier) only get POS + Sales (for returns/exchanges). */
  private readonly cashierPaths = ['/pos', '/sales'];

  mainNav: NavItem[];
  settingsNav: NavItem | null = { icon: 'settings', label: 'Settings', path: '/settings' };

  constructor(private auth: AuthService) {
    const isCashier = this.auth.getCurrentUser()?.role === 'cashier';
    this.mainNav = isCashier
      ? this.allNav.filter((n) => this.cashierPaths.includes(n.path))
      : this.allNav;
    if (isCashier) this.settingsNav = null;
  }
}
