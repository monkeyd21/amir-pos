import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';

interface Sale {
  id: number;
  saleNumber: string;
  customer: { firstName: string; lastName: string } | null;
  items: any[];
  total: number;
  subtotal?: number;
  payments?: { method: string; amount: string | number }[];
  paymentMethod?: string;
  status: string;
  createdAt: string;
}

interface SalesResponse {
  success: boolean;
  data: Sale[];
  meta: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-sales-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StatusBadgeComponent,
    LoadingSpinnerComponent,
    EmptyStateComponent,
  ],
  templateUrl: './sales-list.component.html',
})
export class SalesListComponent implements OnInit {
  sales: Sale[] = [];
  loading = true;
  showFilters = false;

  // Pagination
  currentPage = 1;
  pageSize = 15;
  totalItems = 0;

  // Filters
  statusFilter = '';
  paymentMethodFilter = '';
  startDate = '';
  endDate = '';

  statuses = ['completed', 'pending', 'cancelled', 'returned', 'partially_returned'];
  paymentMethods = ['cash', 'card', 'upi'];

  // Dropdown state
  openMenuId: number | null = null;

  constructor(
    private api: ApiService,
    private router: Router,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadSales();
  }

  loadSales(): void {
    this.loading = true;
    const params: Record<string, string | number | boolean> = {
      page: this.currentPage,
      limit: this.pageSize,
    };
    if (this.statusFilter) params['status'] = this.statusFilter;
    if (this.paymentMethodFilter) params['paymentMethod'] = this.paymentMethodFilter;
    if (this.startDate) params['startDate'] = this.startDate;
    if (this.endDate) params['endDate'] = this.endDate;

    this.api.get<SalesResponse>('/sales', params).subscribe({
      next: (res) => {
        this.sales = res.data || [];
        this.totalItems = res.meta?.total || 0;
        this.loading = false;
      },
      error: () => {
        this.notify.error('Failed to load sales');
        this.loading = false;
      },
    });
  }

  applyFilters(): void {
    this.currentPage = 1;
    this.loadSales();
  }

  clearFilters(): void {
    this.statusFilter = '';
    this.paymentMethodFilter = '';
    this.startDate = '';
    this.endDate = '';
    this.applyFilters();
  }

  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  viewSale(sale: Sale): void {
    this.router.navigate(['/sales', sale.saleNumber || sale.id]);
  }

  getCustomerName(sale: Sale): string {
    if (sale.customer) {
      return `${sale.customer.firstName} ${sale.customer.lastName}`.trim();
    }
    return 'Walk-in Customer';
  }

  getItemsSummary(sale: Sale): string {
    if (!sale.items || sale.items.length === 0) return '-';
    const names = sale.items.map(
      (item: any) => item.variant?.product?.name || item.productName || item.name || 'Item'
    );
    const text = names.slice(0, 2).join(', ');
    if (names.length > 2) return `${text} +${names.length - 2} more`;
    return text;
  }

  getPaymentMethod(sale: Sale): string {
    return sale.payments?.[0]?.method || sale.paymentMethod || '';
  }

  formatPaymentMethod(method: string): string {
    if (!method) return '-';
    return method.toUpperCase();
  }

  formatStatus(value: string): string {
    if (!value) return '';
    return value
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  }

  // Pagination
  get totalPages(): number {
    return Math.ceil(this.totalItems / this.pageSize);
  }

  get pages(): number[] {
    const total = this.totalPages;
    const current = this.currentPage;
    const pages: number[] = [];
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.loadSales();
  }

  toggleMenu(saleId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuId = this.openMenuId === saleId ? null : saleId;
  }

  closeMenu(): void {
    this.openMenuId = null;
  }

  exportCsv(): void {
    this.notify.info('Exporting sales data...');
    // Build CSV from current data
    const headers = ['Sale Number', 'Customer', 'Total', 'Payment', 'Status', 'Date'];
    const rows = this.sales.map((s) => [
      s.saleNumber,
      this.getCustomerName(s),
      s.total,
      s.paymentMethod,
      s.status,
      this.formatDate(s.createdAt),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.notify.success('CSV exported successfully');
  }

  get hasActiveFilters(): boolean {
    return !!(this.statusFilter || this.paymentMethodFilter || this.startDate || this.endDate);
  }
}
