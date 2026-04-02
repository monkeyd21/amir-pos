import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  children?: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatTooltipModule],
  template: `
    <aside
      class="h-full flex flex-col transition-all duration-300"
      [class.w-64]="!collapsed"
      [class.w-16]="collapsed"
      [style.background-color]="'#1E293B'">

      <!-- Logo -->
      <div class="flex items-center h-16 px-4 border-b border-white/10">
        <div class="flex items-center gap-3 overflow-hidden">
          <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <mat-icon class="text-white text-lg">storefront</mat-icon>
          </div>
          <span *ngIf="!collapsed" class="text-white font-semibold text-lg whitespace-nowrap">
            ClothingERP
          </span>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 overflow-y-auto py-4 px-2">
        <div *ngFor="let item of navItems" class="mb-1">
          <!-- Simple nav item (no children) -->
          <a *ngIf="!item.children && item.route"
             [routerLink]="item.route"
             routerLinkActive="bg-blue-600/20 text-white"
             [routerLinkActiveOptions]="{ exact: item.route === '/dashboard' }"
             [matTooltip]="collapsed ? item.label : ''"
             matTooltipPosition="right"
             class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer group">
            <mat-icon class="text-xl flex-shrink-0">{{ item.icon }}</mat-icon>
            <span *ngIf="!collapsed" class="text-sm font-medium whitespace-nowrap">{{ item.label }}</span>
          </a>

          <!-- Nav item with children -->
          <div *ngIf="item.children">
            <button
              (click)="toggleGroup(item.label)"
              [matTooltip]="collapsed ? item.label : ''"
              matTooltipPosition="right"
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer">
              <mat-icon class="text-xl flex-shrink-0">{{ item.icon }}</mat-icon>
              <span *ngIf="!collapsed" class="text-sm font-medium whitespace-nowrap flex-1 text-left">{{ item.label }}</span>
              <mat-icon *ngIf="!collapsed" class="text-sm transition-transform"
                        [class.rotate-180]="expandedGroups.has(item.label)">
                expand_more
              </mat-icon>
            </button>
            <div *ngIf="!collapsed && expandedGroups.has(item.label)"
                 class="ml-4 mt-1 space-y-1">
              <a *ngFor="let child of item.children"
                 [routerLink]="child.route"
                 routerLinkActive="bg-blue-600/20 text-white"
                 class="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer text-sm">
                <mat-icon class="text-base flex-shrink-0">{{ child.icon }}</mat-icon>
                <span class="font-medium whitespace-nowrap">{{ child.label }}</span>
              </a>
            </div>
          </div>
        </div>
      </nav>

      <!-- Collapse toggle -->
      <div class="p-2 border-t border-white/10">
        <button
          (click)="toggleCollapse()"
          class="w-full flex items-center justify-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors">
          <mat-icon>{{ collapsed ? 'chevron_right' : 'chevron_left' }}</mat-icon>
          <span *ngIf="!collapsed" class="text-sm font-medium">Collapse</span>
        </button>
      </div>
    </aside>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
    .rotate-180 {
      transform: rotate(180deg);
    }
  `]
})
export class SidebarComponent {
  @Input() collapsed = false;
  @Output() collapsedChange = new EventEmitter<boolean>();

  expandedGroups = new Set<string>();

  navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
    { label: 'POS', icon: 'point_of_sale', route: '/pos' },
    {
      label: 'Inventory',
      icon: 'inventory_2',
      children: [
        { label: 'Products', icon: 'category', route: '/inventory/products' },
        { label: 'Stock', icon: 'warehouse', route: '/inventory/stock' },
        { label: 'Transfers', icon: 'swap_horiz', route: '/inventory/transfers' },
        { label: 'Barcodes', icon: 'qr_code', route: '/inventory/barcodes' },
      ]
    },
    { label: 'Sales', icon: 'receipt_long', route: '/sales' },
    { label: 'Customers', icon: 'people', route: '/customers' },
    { label: 'Employees', icon: 'badge', route: '/employees' },
    { label: 'Expenses', icon: 'account_balance_wallet', route: '/expenses' },
    { label: 'Accounting', icon: 'calculate', route: '/accounting' },
    { label: 'Reports', icon: 'assessment', route: '/reports' },
    { label: 'Settings', icon: 'settings', route: '/settings' },
  ];

  toggleGroup(label: string): void {
    if (this.expandedGroups.has(label)) {
      this.expandedGroups.delete(label);
    } else {
      this.expandedGroups.add(label);
    }
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.collapsedChange.emit(this.collapsed);
  }
}
