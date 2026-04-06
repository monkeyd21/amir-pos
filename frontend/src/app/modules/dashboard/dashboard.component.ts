import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import Chart from 'chart.js/auto';
import { ApiService } from '../../core/services/api.service';

interface DailySummary {
  totalSales: number;
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
}

interface SaleItem {
  id: number;
  saleNumber: string;
  customer?: { firstName: string; lastName: string };
  total: number;
  status: string;
  createdAt: string;
}

interface InventoryItem {
  id: number;
  sku: string;
  currentStock: number;
  minStockLevel: number;
  variant?: {
    product?: { name: string };
    size?: string;
    color?: string;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('salesChart') salesChartRef!: ElementRef<HTMLCanvasElement>;

  private destroy$ = new Subject<void>();
  private chart: Chart | null = null;

  totalSales = 0;
  totalRevenue = 0;
  totalCustomers = 0;
  lowStockCount = 0;

  recentSales: SaleItem[] = [];
  lowStockItems: InventoryItem[] = [];

  loading = true;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadData();
  }

  ngAfterViewInit(): void {
    // Chart will be initialized after data loads
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.chart?.destroy();
  }

  private loadData(): void {
    forkJoin({
      summary: this.api.get<ApiResponse<DailySummary>>('/reports/daily-summary'),
      sales: this.api.get<ApiResponse<SaleItem[]>>('/sales', {
        limit: 5,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
      customers: this.api.get<ApiResponse<any[]>>('/customers', { limit: 1 }),
      lowStock: this.api.get<ApiResponse<InventoryItem[]>>('/inventory', {
        lowStock: true,
      }),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ summary, sales, customers, lowStock }) => {
          this.totalSales = summary.data?.totalSales ?? 0;
          this.totalRevenue = summary.data?.totalRevenue ?? 0;

          this.recentSales = sales.data ?? [];
          this.totalCustomers = customers.meta?.total ?? 0;

          this.lowStockItems = lowStock.data ?? [];
          this.lowStockCount = lowStock.meta?.total ?? this.lowStockItems.length;

          this.loading = false;
          setTimeout(() => this.initChart(), 0);
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  private initChart(): void {
    const canvas = this.salesChartRef?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(70, 95, 255, 0.6)');
    gradient.addColorStop(1, 'rgba(70, 95, 255, 0.05)');

    this.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [
          {
            label: 'Sales',
            data: [12, 19, 8, 15, 22, 30, 18],
            backgroundColor: gradient,
            borderColor: '#465fff',
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#222a3d',
            titleColor: '#dae2fd',
            bodyColor: '#c5c5d8',
            borderColor: '#444656',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#8f8fa2', font: { size: 11 } },
            border: { display: false },
          },
          y: {
            grid: { color: 'rgba(68, 70, 86, 0.3)' },
            ticks: { color: '#8f8fa2', font: { size: 11 } },
            border: { display: false },
          },
        },
      },
    });
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  formatStatus(status: string): string {
    return status
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  getStatusClasses(status: string): string {
    switch (status) {
      case 'completed':
        return 'bg-green-500/10 text-green-400';
      case 'pending':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'returned':
        return 'bg-red-500/10 text-red-400';
      case 'partially_returned':
        return 'bg-orange-500/10 text-orange-400';
      case 'cancelled':
        return 'bg-red-500/10 text-red-400';
      default:
        return 'bg-primary/10 text-primary';
    }
  }

  getProductName(item: InventoryItem): string {
    return item.variant?.product?.name || 'Unknown Product';
  }

  getVariantLabel(item: InventoryItem): string {
    const parts: string[] = [];
    if (item.variant?.size) parts.push(item.variant.size);
    if (item.variant?.color) parts.push(item.variant.color);
    return parts.length > 0 ? parts.join(' / ') : '';
  }
}
