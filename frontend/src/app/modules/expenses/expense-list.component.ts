import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface ExpenseCategory {
  id: number;
  name: string;
}

interface Expense {
  id: number;
  description: string;
  amount: number;
  date: string;
  notes?: string;
  status: string;
  category?: ExpenseCategory;
  createdBy?: { firstName: string; lastName: string };
  createdAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './expense-list.component.html',
})
export class ExpenseListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  expenses: Expense[] = [];
  categories: ExpenseCategory[] = [];
  loading = true;

  selectedCategory = '';
  dateFrom = '';
  dateTo = '';

  page = 1;
  limit = 20;
  total = 0;

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
    this.loadExpenses();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCategories(): void {
    this.api
      .get<ApiResponse<ExpenseCategory[]>>('/expenses/categories')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.categories = res.data || [];
        },
        error: () => {},
      });
  }

  loadExpenses(): void {
    this.loading = true;
    const params: Record<string, string | number | boolean> = {
      page: this.page,
      limit: this.limit,
    };
    if (this.selectedCategory) params['categoryId'] = this.selectedCategory;
    if (this.dateFrom) params['dateFrom'] = this.dateFrom;
    if (this.dateTo) params['dateTo'] = this.dateTo;

    this.api
      .get<ApiResponse<Expense[]>>('/expenses', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.expenses = res.data || [];
          this.total = res.meta?.total ?? this.expenses.length;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load expenses');
        },
      });
  }

  onFilter(): void {
    this.page = 1;
    this.loadExpenses();
  }

  clearFilters(): void {
    this.selectedCategory = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.page = 1;
    this.loadExpenses();
  }

  deleteExpense(id: number): void {
    if (!confirm('Are you sure you want to delete this expense?')) return;

    this.api
      .delete<ApiResponse<any>>(`/expenses/${id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notify.success('Expense deleted');
          this.loadExpenses();
        },
        error: (err) => {
          this.notify.error(err.error?.error || 'Failed to delete expense');
        },
      });
  }

  get totalAmount(): number {
    return this.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  getStatusClasses(status: string): string {
    switch (status?.toLowerCase()) {
      case 'approved':
        return 'bg-green-500/10 text-green-400';
      case 'pending':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'rejected':
        return 'bg-red-500/10 text-red-400';
      default:
        return 'bg-surface-variant/30 text-on-surface-variant';
    }
  }

  formatStatus(status: string): string {
    if (!status) return 'Pending';
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
      this.loadExpenses();
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page++;
      this.loadExpenses();
    }
  }
}
