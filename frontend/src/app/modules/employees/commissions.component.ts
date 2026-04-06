import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface CommissionRecord {
  id: number;
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    role: string;
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

  // Filters
  filterStatus = '';
  filterEmployeeId = '';
  filterStartDate = '';
  filterEndDate = '';

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
            `Commission for ${record.employee?.firstName} ${record.employee?.lastName} marked as paid`
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
    return this.records.reduce((sum, r) => sum + (r.amount || 0), 0);
  }

  get pendingCommissions(): number {
    return this.records
      .filter((r) => r.status?.toLowerCase() === 'pending')
      .reduce((sum, r) => sum + (r.amount || 0), 0);
  }

  get paidCommissions(): number {
    return this.records
      .filter((r) => r.status?.toLowerCase() === 'paid')
      .reduce((sum, r) => sum + (r.amount || 0), 0);
  }

  getSaleTotal(record: CommissionRecord): number | null {
    return record.sale?.totalAmount ?? record.sale?.total ?? null;
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
