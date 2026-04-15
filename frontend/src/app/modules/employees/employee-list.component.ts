import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  status: string;
  branch?: { id: number; name: string };
  createdAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './employee-list.component.html',
})
export class EmployeeListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  employees: Employee[] = [];
  loading = true;
  searchQuery = '';

  page = 1;
  limit = 20;
  total = 0;

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadEmployees();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadEmployees(): void {
    this.loading = true;
    const params: Record<string, string | number | boolean> = {
      page: this.page,
      limit: this.limit,
    };
    if (this.searchQuery) params['search'] = this.searchQuery;

    this.api
      .get<ApiResponse<Employee[]>>('/employees', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.employees = res.data || [];
          this.total = res.meta?.total ?? this.employees.length;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load employees');
        },
      });
  }

  onSearch(): void {
    this.page = 1;
    this.loadEmployees();
  }

  formatRole(role: string): string {
    return role
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  getRoleClasses(role: string): string {
    switch (role.toLowerCase()) {
      case 'admin':
        return 'bg-primary-container/15 text-primary';
      case 'manager':
        return 'bg-tertiary/15 text-tertiary';
      case 'cashier':
        return 'bg-green-500/10 text-green-400';
      default:
        return 'bg-surface-variant/30 text-on-surface-variant';
    }
  }

  getStatusClasses(status: string): string {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'bg-green-500/10 text-green-400';
      case 'inactive':
        return 'bg-red-500/10 text-red-400';
      default:
        return 'bg-surface-variant/30 text-on-surface-variant';
    }
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page--;
      this.loadEmployees();
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page++;
      this.loadEmployees();
    }
  }
}
