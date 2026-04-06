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
  };
  amount: number;
  rate: number;
  status: string;
  createdAt: string;
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
  loading = true;

  page = 1;
  limit = 20;
  total = 0;

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadCommissions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCommissions(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<CommissionRecord[]>>('/employees/commissions', {
        page: this.page,
        limit: this.limit,
      })
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

  get totalCommissions(): number {
    return this.records.reduce((sum, r) => sum + (r.amount || 0), 0);
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
