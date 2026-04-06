import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

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
  mainNav: NavItem[] = [
    { icon: 'dashboard', label: 'Dashboard', path: '/dashboard' },
    { icon: 'point_of_sale', label: 'POS', path: '/pos' },
    { icon: 'inventory_2', label: 'Inventory', path: '/inventory' },
    { icon: 'payments', label: 'Sales', path: '/sales' },
    { icon: 'group', label: 'Customers', path: '/customers' },
    { icon: 'badge', label: 'Employees', path: '/employees' },
    { icon: 'receipt_long', label: 'Expenses', path: '/expenses' },
    { icon: 'account_balance', label: 'Accounting', path: '/accounting' },
    { icon: 'analytics', label: 'Reports', path: '/reports' },
  ];

  settingsNav: NavItem = { icon: 'settings', label: 'Settings', path: '/settings' };
}
