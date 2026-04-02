import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, takeUntil, catchError, of, forkJoin } from 'rxjs';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { CurrencyPipe } from '../../shared/pipes/currency.pipe';
import { ApiService } from '../../core/services/api.service';
import { BranchService } from '../../core/services/branch.service';

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
  saleId?: number;
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
    MatProgressSpinnerModule,
    PageHeaderComponent,
    StatusBadgeComponent,
    CurrencyPipe,
  ],
  template: `
    <app-page-header
      title="Dashboard"
      subtitle="Welcome back! Here's your business overview.">
    </app-page-header>

    <!-- Loading indicator -->
    <div *ngIf="loading" class="flex items-center gap-2 mb-4 text-sm text-slate-400">
      <mat-spinner diameter="16"></mat-spinner>
      <span>Refreshing data...</span>
    </div>

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
      <!-- Sales Chart -->
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
        <!-- Colored bar chart -->
        <div class="flex items-end gap-3 h-48">
          <div *ngFor="let day of salesData; let i = index" class="flex-1 flex flex-col items-center gap-2">
            <span class="text-xs text-slate-500 font-medium">{{ day.amount | currency }}</span>
            <div class="w-full rounded-t-lg transition-all duration-500 hover:opacity-80 cursor-pointer"
                 [style.height.%]="(day.amount / maxSales) * 100"
                 [style.min-height.px]="4"
                 [style.background]="getBarGradient(i)"
                 (click)="navigateTo('/sales')">
            </div>
            <span class="text-xs text-slate-400 font-medium">{{ day.label }}</span>
          </div>
        </div>
      </div>

      <!-- Top Products -->
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-slate-800">Top Products</h3>
          <button mat-button color="primary" class="text-sm" (click)="navigateTo('/inventory/products')">View All</button>
        </div>
        <div class="space-y-4">
          <div *ngFor="let product of topProducts; let i = index"
               class="flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded-lg p-1 -mx-1 transition-colors"
               (click)="navigateTo('/inventory/products')">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                 [style.background-color]="rankColors[i] || '#94A3B8'">
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
          <tr mat-row *matRowDef="let row; columns: recentSalesColumns;"
              class="hover:bg-slate-50 cursor-pointer"
              (click)="navigateToSale(row)"></tr>
        </table>
      </div>

      <!-- Low Stock Alerts -->
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <mat-icon class="text-amber-500">warning</mat-icon>
            <h3 class="text-lg font-semibold text-slate-800">Low Stock Alerts</h3>
          </div>
          <button mat-button color="primary" class="text-sm" (click)="navigateTo('/inventory/stock')">View All</button>
        </div>
        <div class="space-y-3">
          <div *ngFor="let item of lowStockItems"
               class="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100 cursor-pointer hover:bg-amber-100/50 transition-colors"
               (click)="navigateTo('/inventory/stock')">
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
export class DashboardComponent implements OnInit, OnDestroy {
  private router: Router;
  private apiService: ApiService;
  private branchService: BranchService;
  private destroy$ = new Subject<void>();

  selectedPeriod = '7D';
  loading = false;

  // Bar chart color palette
  barColors = [
    ['#3B82F6', '#60A5FA'],
    ['#8B5CF6', '#A78BFA'],
    ['#EC4899', '#F472B6'],
    ['#F59E0B', '#FBBF24'],
    ['#10B981', '#34D399'],
    ['#2563EB', '#3B82F6'],
    ['#6366F1', '#818CF8'],
  ];

  // Rank badge colors for top products
  rankColors = ['#F59E0B', '#94A3B8', '#CD7F32', '#6366F1', '#8B5CF6'];

  constructor(router: Router, apiService: ApiService, branchService: BranchService) {
    this.router = router;
    this.apiService = apiService;
    this.branchService = branchService;
  }

  kpiCards: KpiCard[] = [
    {
      title: "Today's Sales",
      value: '0',
      icon: 'shopping_cart',
      change: '--',
      changeType: 'neutral',
      color: '#2563EB',
      bgColor: '#EFF6FF',
      route: '/sales',
    },
    {
      title: "Today's Revenue",
      value: '\u20B90',
      icon: 'account_balance',
      change: '--',
      changeType: 'neutral',
      color: '#22C55E',
      bgColor: '#F0FDF4',
      route: '/accounting',
    },
    {
      title: 'Total Customers',
      value: '0',
      icon: 'people',
      change: '--',
      changeType: 'neutral',
      color: '#8B5CF6',
      bgColor: '#F5F3FF',
      route: '/customers',
    },
    {
      title: 'Low Stock Items',
      value: '0',
      icon: 'warning',
      change: '--',
      changeType: 'neutral',
      color: '#F59E0B',
      bgColor: '#FFFBEB',
      route: '/inventory/stock',
    },
  ];

  salesData: { label: string; amount: number }[] = [];

  get maxSales(): number {
    const max = Math.max(...this.salesData.map(d => d.amount), 0);
    return max || 1;
  }

  recentSalesColumns = ['id', 'customer', 'items', 'total', 'status', 'time'];

  recentSales: RecentSale[] = [];

  topProducts: TopProduct[] = [];

  lowStockItems: { name: string; sku: string; stock: number; minStock: number }[] = [];

  ngOnInit(): void {
    this.loadDashboardData();

    // Reload dashboard data when branch changes
    this.branchService.currentBranch$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.loadDashboardData();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDashboardData(): void {
    this.loading = true;

    forkJoin({
      summary: this.apiService.get<any>('/reports/daily-summary').pipe(catchError(() => of(null))),
      sales: this.apiService.get<any>('/sales', { limit: '5', sort: 'createdAt', order: 'desc' }).pipe(catchError(() => of(null))),
      customers: this.apiService.get<any>('/customers', { limit: '1' }).pipe(catchError(() => of(null))),
      lowStock: this.apiService.get<any>('/inventory', { lowStock: 'true', limit: '10' }).pipe(catchError(() => of(null))),
    }).pipe(takeUntil(this.destroy$)).subscribe((results) => {
      this.loading = false;

      // KPI: Sales count & revenue from daily summary
      if (results.summary?.data) {
        const d = results.summary.data;
        this.kpiCards[0].value = String(d.salesCount ?? 0);
        this.kpiCards[1].value = '\u20B9' + Number(d.totalSales ?? 0).toLocaleString('en-IN');
      }

      // KPI: Total customers
      if (results.customers?.meta) {
        this.kpiCards[2].value = Number(results.customers.meta.total ?? 0).toLocaleString('en-IN');
      }

      // KPI: Low stock count + items list
      if (results.lowStock?.data) {
        const items = Array.isArray(results.lowStock.data) ? results.lowStock.data : [];
        this.kpiCards[3].value = String(results.lowStock.meta?.total ?? items.length);
        this.kpiCards[3].changeType = items.length > 0 ? 'down' : 'neutral';
        this.lowStockItems = items.slice(0, 5).map((item: any) => ({
          name: item.variant
            ? `${item.variant.product?.name || 'Product'} (${item.variant.size || ''}/${item.variant.color || ''})`
            : 'Unknown',
          sku: item.variant?.sku || item.variant?.barcode || '',
          stock: item.quantity ?? 0,
          minStock: item.minQuantity ?? 0,
        }));
      }

      // Recent sales
      if (results.sales?.data) {
        const sales = Array.isArray(results.sales.data) ? results.sales.data : [];
        this.recentSales = sales.slice(0, 5).map((s: any) => ({
          id: s.saleNumber || `#${s.id}`,
          saleId: s.id,
          customer: s.customer
            ? `${s.customer.firstName} ${s.customer.lastName}`
            : 'Walk-in Customer',
          items: s.items?.length ?? 0,
          total: Number(s.total ?? 0),
          status: s.status || 'completed',
          time: this.getTimeAgo(s.createdAt),
        }));
      }
    });
  }

  getBarGradient(index: number): string {
    const colors = this.barColors[index % this.barColors.length];
    return `linear-gradient(to top, ${colors[0]}, ${colors[1]})`;
  }

  private getChangeType(change: string | undefined): 'up' | 'down' | 'neutral' {
    if (!change) return 'neutral';
    if (change.startsWith('+') && change !== '+0%' && change !== '+0') return 'up';
    if (change.startsWith('-')) return 'down';
    return 'neutral';
  }

  private getTimeAgo(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs} hr${diffHrs > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  navigateToSale(sale: RecentSale): void {
    // Use the numeric saleId if available (from API), otherwise use the display id
    const id = sale.saleId || sale.id;
    this.router.navigate(['/sales', id]);
  }
}
