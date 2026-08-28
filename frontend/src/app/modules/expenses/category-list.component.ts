import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface PayableCategory {
  id: number;
  name: string;
  isActive: boolean;
  isRecurring: boolean;
  defaultAmount?: string | number | null;
  dueDay?: number | null;
  isSystem: boolean;
  sortOrder: number;
  accountId?: number | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-expense-category-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './category-list.component.html',
})
export class CategoryListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  categories: PayableCategory[] = [];
  loading = true;
  togglingId: number | null = null;

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCategories(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<PayableCategory[]>>('/payables/categories')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.categories = (res.data || []).sort((a, b) => {
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.name.localeCompare(b.name);
          });
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.notify.error(err.error?.error || 'Failed to load categories');
        },
      });
  }

  get recurring(): PayableCategory[] {
    return this.categories.filter((c) => c.isRecurring);
  }

  get oneOff(): PayableCategory[] {
    return this.categories.filter((c) => !c.isRecurring);
  }

  get monthlyRecurringTotal(): number {
    return this.recurring
      .filter((c) => c.isActive)
      .reduce((sum, c) => sum + Number(c.defaultAmount ?? 0), 0);
  }

  /**
   * Categories are deactivated, never hard-deleted — old payables still point
   * at them and the month history has to stay readable.
   */
  toggleActive(cat: PayableCategory): void {
    if (cat.isSystem) return;
    if (this.togglingId !== null) return;
    if (
      cat.isActive &&
      !confirm(
        `Deactivate "${cat.name}"? It stops appearing on new expenses; existing ones keep it.`
      )
    ) {
      return;
    }

    this.togglingId = cat.id;
    this.api
      .put<ApiResponse<PayableCategory>>(`/payables/categories/${cat.id}`, {
        isActive: !cat.isActive,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.togglingId = null;
          this.notify.success(cat.isActive ? 'Category deactivated' : 'Category reactivated');
          this.loadCategories();
        },
        error: (err) => {
          this.togglingId = null;
          this.notify.error(err.error?.error || 'Failed to update category');
        },
      });
  }

  formatCurrency(value: string | number | null | undefined): string {
    const n = Number(value ?? 0);
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
  }

  ordinal(day: number | null | undefined): string {
    if (!day) return '—';
    const rem100 = day % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
    switch (day % 10) {
      case 1:
        return `${day}st`;
      case 2:
        return `${day}nd`;
      case 3:
        return `${day}rd`;
      default:
        return `${day}th`;
    }
  }
}
