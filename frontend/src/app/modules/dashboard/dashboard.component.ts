import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { CurrencyPipe } from '../../shared/pipes/currency.pipe';

interface KpiCard {
  title: string;
  value: string;
  icon: string;
  change: string;
  changeType: 'up' | 'down' | 'neutral';
  color: string;
  bgColor: string;
  route: string;
}

interface RecentSale {
  id: string;
  customer: string;
  items: number;
  total: number;
  status: string;
  time: string;
}

interface TopProduct {
  name: string;
  sold: number;
  revenue: number;
  category: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatTableModule,
    MatButtonModule,
    MatChipsModule,
    PageHeaderComponent,
    StatusBadgeComponent,
    CurrencyPipe,
  ],
  template: `
    <app-page-header
      title="Dashboard"
      subtitle="Welcome back! Here's your business overview.">
    </app-page-header>

    <!-- KPI Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div *ngFor="let card of kpiCards"
           class="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow cursor-pointer"
           (click)="navigateTo(card.route)">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-sm text-slate-500 font-medium">{{ card.title }}</p>
            <p class="text-2xl font-bold text-slate-800 mt-1">{{ card.value }}</p>
            <div class="flex items-center gap-1 mt-2">
              <mat-icon
                class="text-sm"
                [style.color]="card.changeType === 'up' ? '#22C55E' : card.changeType === 'down' ? '#EF4444' : '#94A3B8'">
                {{ card.changeType === 'up' ? 'trending_up' : card.changeType === 'down' ? 'trending_down' : 'remove' }}
              </mat-icon>
              <span class="text-xs font-medium"
                    [style.color]="card.changeType === 'up' ? '#22C55E' : card.changeType === 'down' ? '#EF4444' : '#94A3B8'">
                {{ card.change }}
              </span>
              <span class="text-xs text-slate-400">vs yesterday</span>
            </div>
          </div>
          <div class="w-12 h-12 rounded-xl flex items-center justify-center"
               [style.background-color]="card.bgColor">
            <mat-icon [style.color]="card.color">{{ card.icon }}</mat-icon>
          </div>
        </div>
      </div>
    </div>

    <!-- Charts & Tables Row -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <!-- Sales Chart Placeholder -->
      <div class="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-semibold text-slate-800">Sales Overview</h3>
          <div class="flex gap-2">
            <button *ngFor="let period of ['7D', '30D', '90D']"
                    class="px-3 py-1 text-xs rounded-lg border transition-colors"
                    [class.bg-blue-600]="selectedPeriod === period"
                    [class.text-white]="selectedPeriod === period"
                    [class.border-blue-600]="selectedPeriod === period"
                    [class.border-slate-200]="selectedPeriod !== period"
                    [class.text-slate-500]="selectedPeriod !== period"
                    (click)="selectedPeriod = period">
              {{ period }}
            </button>
          </div>
        </div>
        <!-- Simple bar chart visualization -->
        <div class="flex items-end gap-3 h-48">
          <div *ngFor="let day of salesData" class="flex-1 flex flex-col items-center gap-2">
            <span class="text-xs text-slate-500 font-medium">{{ day.amount | currency }}</span>
            <div class="w-full bg-blue-600 rounded-t-lg transition-all duration-500"
                 [style.height.%]="(day.amount / maxSales) * 100"
                 [style.min-height.px]="4">
            </div>
            <span class="text-xs text-slate-400">{{ day.label }}</span>
          </div>
        </div>
      </div>

      <!-- Top Products -->
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <h3 class="text-lg font-semibold text-slate-800 mb-4">Top Products</h3>
        <div class="space-y-4">
          <div *ngFor="let product of topProducts; let i = index"
               class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-500">
              {{ i + 1 }}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-700 truncate">{{ product.name }}</p>
              <p class="text-xs text-slate-400">{{ product.category }}</p>
            </div>
            <div class="text-right">
              <p class="text-sm font-semibold text-slate-700">{{ product.sold }} sold</p>
              <p class="text-xs text-slate-400">{{ product.revenue | currency }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Sales & Low Stock -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Recent Sales -->
      <div class="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-800">Recent Sales</h3>
          <button mat-button color="primary" class="text-sm" (click)="navigateTo('/sales')">View All</button>
        </div>
        <table mat-table [dataSource]="recentSales" class="w-full">
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef class="text-slate-500 font-medium">Invoice</th>
            <td mat-cell *matCellDef="let sale" class="font-medium text-blue-600">{{ sale.id }}</td>
          </ng-container>
          <ng-container matColumnDef="customer">
            <th mat-header-cell *matHeaderCellDef class="text-slate-500 font-medium">Customer</th>
            <td mat-cell *matCellDef="let sale">{{ sale.customer }}</td>
          </ng-container>
          <ng-container matColumnDef="items">
            <th mat-header-cell *matHeaderCellDef class="text-slate-500 font-medium">Items</th>
            <td mat-cell *matCellDef="let sale">{{ sale.items }}</td>
          </ng-container>
          <ng-container matColumnDef="total">
            <th mat-header-cell *matHeaderCellDef class="text-slate-500 font-medium">Total</th>
            <td mat-cell *matCellDef="let sale" class="font-semibold">{{ sale.total | currency }}</td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef class="text-slate-500 font-medium">Status</th>
            <td mat-cell *matCellDef="let sale">
              <app-status-badge [status]="sale.status"></app-status-badge>
            </td>
          </ng-container>
          <ng-container matColumnDef="time">
            <th mat-header-cell *matHeaderCellDef class="text-slate-500 font-medium">Time</th>
            <td mat-cell *matCellDef="let sale" class="text-slate-400">{{ sale.time }}</td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="recentSalesColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: recentSalesColumns;" class="hover:bg-slate-50"></tr>
        </table>
      </div>

      <!-- Low Stock Alerts -->
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <div class="flex items-center gap-2 mb-4">
          <mat-icon class="text-amber-500">warning</mat-icon>
          <h3 class="text-lg font-semibold text-slate-800">Low Stock Alerts</h3>
        </div>
        <div class="space-y-3">
          <div *ngFor="let item of lowStockItems"
               class="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
            <div class="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <mat-icon class="text-amber-600 text-lg">inventory</mat-icon>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-700 truncate">{{ item.name }}</p>
              <p class="text-xs text-slate-400">SKU: {{ item.sku }}</p>
            </div>
            <div class="text-right">
              <p class="text-sm font-bold text-amber-600">{{ item.stock }} left</p>
              <p class="text-xs text-slate-400">Min: {{ item.minStock }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
    table {
      width: 100%;
    }
    .mat-mdc-row:hover {
      background-color: #F8FAFC;
    }
  `]
})
export class DashboardComponent implements OnInit {
  private router: Router;
  selectedPeriod = '7D';

  constructor(router: Router) {
    this.router = router;
  }

  kpiCards: KpiCard[] = [
    {
      title: "Today's Sales",
      value: '47',
      icon: 'shopping_cart',
      change: '+12%',
      changeType: 'up',
      color: '#2563EB',
      bgColor: '#EFF6FF',
      route: '/sales',
    },
    {
      title: "Today's Revenue",
      value: '\u20B985,400',
      icon: 'account_balance',
      change: '+8.2%',
      changeType: 'up',
      color: '#22C55E',
      bgColor: '#F0FDF4',
      route: '/accounting',
    },
    {
      title: 'Total Customers',
      value: '1,284',
      icon: 'people',
      change: '+3.1%',
      changeType: 'up',
      color: '#8B5CF6',
      bgColor: '#F5F3FF',
      route: '/customers',
    },
    {
      title: 'Low Stock Items',
      value: '12',
      icon: 'warning',
      change: '+4',
      changeType: 'down',
      color: '#F59E0B',
      bgColor: '#FFFBEB',
      route: '/inventory/stock',
    },
  ];

  salesData = [
    { label: 'Mon', amount: 12400 },
    { label: 'Tue', amount: 18200 },
    { label: 'Wed', amount: 15600 },
    { label: 'Thu', amount: 22100 },
    { label: 'Fri', amount: 19800 },
    { label: 'Sat', amount: 28500 },
    { label: 'Sun', amount: 17300 },
  ];

  get maxSales(): number {
    return Math.max(...this.salesData.map(d => d.amount));
  }

  recentSalesColumns = ['id', 'customer', 'items', 'total', 'status', 'time'];

  recentSales: RecentSale[] = [
    { id: 'INV-001', customer: 'Rahul Sharma', items: 3, total: 4500, status: 'completed', time: '2 min ago' },
    { id: 'INV-002', customer: 'Priya Patel', items: 1, total: 1200, status: 'completed', time: '15 min ago' },
    { id: 'INV-003', customer: 'Amit Kumar', items: 5, total: 8900, status: 'pending', time: '32 min ago' },
    { id: 'INV-004', customer: 'Sneha Gupta', items: 2, total: 3200, status: 'completed', time: '1 hr ago' },
    { id: 'INV-005', customer: 'Walk-in Customer', items: 1, total: 750, status: 'refunded', time: '2 hrs ago' },
  ];

  topProducts: TopProduct[] = [
    { name: 'Cotton Formal Shirt', sold: 24, revenue: 28800, category: 'Shirts' },
    { name: 'Slim Fit Jeans', sold: 18, revenue: 25200, category: 'Jeans' },
    { name: 'Printed Kurti Set', sold: 15, revenue: 22500, category: 'Ethnic Wear' },
    { name: 'Polo T-Shirt', sold: 12, revenue: 10800, category: 'T-Shirts' },
    { name: 'Chino Pants', sold: 10, revenue: 14000, category: 'Trousers' },
  ];

  lowStockItems = [
    { name: 'White Formal Shirt (M)', sku: 'SHT-001-M', stock: 3, minStock: 10 },
    { name: 'Blue Slim Jeans (32)', sku: 'JNS-012-32', stock: 2, minStock: 8 },
    { name: 'Black Polo T-Shirt (L)', sku: 'TSH-008-L', stock: 1, minStock: 5 },
    { name: 'Cotton Kurti (S)', sku: 'KRT-005-S', stock: 4, minStock: 10 },
  ];

  ngOnInit(): void {
    // In production, these would be API calls
    // this.loadDashboardData();
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }
}
