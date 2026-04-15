import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface CommissionRecord {
  id: number;
  user: {
    id: number;
    firstName: string;
    lastName: string;
    role?: string;
  };
  sale?: {
    id: number;
    saleNumber: string;
    totalAmount: number;
    total?: number;
  };
  amount: number;
  rate: number;
  status: string;
  createdAt: string;
}

interface Employee {
  id: number;
  firstName: string;
  lastName: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-commissions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './commissions.component.html',
})
export class CommissionsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  records: CommissionRecord[] = [];
  employees: Employee[] = [];
  loading = true;
  payingId: number | null = null;
  calculating = false;
  bulkPaying = false;
  commissionMode: 'item_level' | 'bill_level' = 'item_level';

  // Filters
  filterStatus = '';
  filterEmployeeId = '';
  filterStartDate = '';
  filterEndDate = '';

  // Calculate commission date range
  calcStartDate = '';
  calcEndDate = '';

  page = 1;
  limit = 20;
  total = 0;

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadEmployees();
    this.loadCommissions();
    this.loadCommissionMode();

    // Default calc date range to current month
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    this.calcStartDate = `${y}-${m}-01`;
    this.calcEndDate = `${y}-${m}-${String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
    this.payStartDate = this.calcStartDate;
    this.payEndDate = this.calcEndDate;
  }

  loadCommissionMode(): void {
    this.api
      .get<any>('/settings/commission-mode')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.commissionMode = res.data?.commissionMode ?? 'item_level';
        },
      });
  }

  calculateCommissions(): void {
    if (this.calculating || !this.calcStartDate || !this.calcEndDate) return;
    this.calculating = true;
    this.api
      .get<any>('/employees/commissions/calculate', {
        startDate: this.calcStartDate,
        endDate: this.calcEndDate,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.calculating = false;
          const d = res.data;
          this.notify.success(`${d.created} commission(s) created, ${d.skipped} skipped (mode: ${d.mode})`);
          this.loadCommissions();
        },
        error: () => {
          this.calculating = false;
        },
      });
  }

  // Bulk pay date range (defaults to same as calc range)
  payStartDate = '';
  payEndDate = '';
  payEmployeeId: string = '';

  bulkPay(): void {
    if (this.bulkPaying || !this.payStartDate || !this.payEndDate) return;
    if (!confirm('Mark all pending commissions in this date range as paid?')) return;

    this.bulkPaying = true;
    const body: any = {
      startDate: this.payStartDate,
      endDate: this.payEndDate,
    };
    if (this.payEmployeeId) body.userId = parseInt(this.payEmployeeId, 10);

    this.api
      .post<any>('/employees/commissions/pay-bulk', body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.bulkPaying = false;
          this.notify.success(res.message || 'Commissions paid');
          this.loadCommissions();
        },
        error: () => {
          this.bulkPaying = false;
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadEmployees(): void {
    this.api
      .get<ApiResponse<Employee[]>>('/employees', { limit: 200 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.employees = res.data || [];
        },
        error: () => {
          // Silently fail — dropdown just won't have options
        },
      });
  }

  loadCommissions(): void {
    this.loading = true;
    const params: any = {
      page: this.page,
      limit: this.limit,
    };
    if (this.filterStatus) params.status = this.filterStatus;
    if (this.filterEmployeeId) params.userId = this.filterEmployeeId;
    if (this.filterStartDate) params.startDate = this.filterStartDate;
    if (this.filterEndDate) params.endDate = this.filterEndDate;

    this.api
      .get<ApiResponse<CommissionRecord[]>>('/employees/commissions', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.records = res.data || [];
          this.total = res.meta?.total ?? this.records.length;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.records = [];
          this.notify.error('Failed to load commissions');
        },
      });
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadCommissions();
  }

  clearFilters(): void {
    this.filterStatus = '';
    this.filterEmployeeId = '';
    this.filterStartDate = '';
    this.filterEndDate = '';
    this.page = 1;
    this.loadCommissions();
  }

  get hasActiveFilters(): boolean {
    return !!(this.filterStatus || this.filterEmployeeId || this.filterStartDate || this.filterEndDate);
  }

  markAsPaid(record: CommissionRecord): void {
    if (this.payingId) return;
    this.payingId = record.id;

    this.api
      .put<ApiResponse<CommissionRecord>>(`/employees/commissions/${record.id}/pay`, {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.payingId = null;
          this.notify.success(
            `Commission for ${record.user?.firstName} ${record.user?.lastName} marked as paid`
          );
          this.loadCommissions();
        },
        error: (err) => {
          this.payingId = null;
          const msg = err.error?.error || err.error?.message || 'Failed to mark commission as paid';
          this.notify.error(msg);
        },
      });
  }

  get totalCommissions(): number {
    return this.records.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  }

  get pendingCommissions(): number {
    return this.records
      .filter((r) => r.status?.toLowerCase() === 'pending')
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  }

  get paidCommissions(): number {
    return this.records
      .filter((r) => r.status?.toLowerCase() === 'paid')
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  }

  getSaleTotal(record: CommissionRecord): number | null {
    const v = record.sale?.totalAmount ?? record.sale?.total;
    return v != null ? Number(v) : null;
  }

  getStatusClasses(status: string): string {
    switch (status?.toLowerCase()) {
      case 'paid':
        return 'bg-green-500/10 text-green-400';
      case 'pending':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'cancelled':
        return 'bg-red-500/10 text-red-400';
      default:
        return 'bg-surface-variant/30 text-on-surface-variant';
    }
  }

  formatStatus(status: string): string {
    return status
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
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

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page--;
      this.loadCommissions();
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page++;
      this.loadCommissions();
    }
  }
}
