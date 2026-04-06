import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

interface Transfer {
  id: number;
  transferNumber?: string;
  fromBranch?: { id: number; name: string };
  toBranch?: { id: number; name: string };
  status: string;
  items?: any[];
  _count?: { items: number };
  notes?: string;
  createdAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-transfers',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PageHeaderComponent,
    LoadingSpinnerComponent,
    EmptyStateComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './transfers.component.html',
})
export class TransfersComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  transfers: Transfer[] = [];
  loading = true;

  page = 1;
  limit = 10;
  total = 0;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private router: Router
  ) {}

  createTransfer(): void {
    this.router.navigate(['/inventory/transfers/create']);
  }

  ngOnInit(): void {
    this.loadTransfers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTransfers(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<Transfer[]>>('/inventory/transfer', {
        page: this.page,
        limit: this.limit,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.transfers = res.data ?? [];
          this.total = res.meta?.total ?? 0;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load transfers');
        },
      });
  }

  getItemCount(transfer: Transfer): number {
    return transfer._count?.items || transfer.items?.length || 0;
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  get pages(): number[] {
    const total = this.totalPages;
    const current = this.page;
    const pages: number[] = [];
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.loadTransfers();
  }
}
