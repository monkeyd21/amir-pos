import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CustomerDialogComponent } from './customer-dialog.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';

interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  totalSpent: number;
  loyaltyPoints: number;
  loyaltyTier: string;
  visitCount: number;
  tier: string;
  createdAt: string;
  lastPurchaseDate: string | null;
}

interface CustomerResponse {
  success: boolean;
  data: Customer[];
  meta: { total: number };
}

interface TopCustomerResponse {
  success: boolean;
  data: Customer[];
}

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LoadingSpinnerComponent,
    EmptyStateComponent,
    SearchInputComponent,
  ],
  templateUrl: './customer-list.component.html',
})
export class CustomerListComponent implements OnInit {
  customers: Customer[] = [];
  topCustomers: Customer[] = [];
  loading = true;
  loadingTop = true;
  searchQuery = '';
  page = 1;
  limit = 10;
  total = 0;
  showFilters = false;
  topSortBy: 'totalSpent' | 'visitCount' | 'loyaltyPoints' = 'totalSpent';

  // KPIs
  totalCustomers = 0;
  avgSpend = 0;
  totalLoyaltyPoints = 0;
  inactiveCount = 0;

  // Max spent for progress bar scaling
  maxSpent = 0;

  private currencyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  constructor(
    private api: ApiService,
    private router: Router,
    private notification: NotificationService,
    private dialog: DialogService
  ) {}

  ngOnInit(): void {
    this.loadCustomers();
    this.loadTopCustomers();
  }

  loadCustomers(): void {
    this.loading = true;
    const params: Record<string, string | number | boolean> = {
      page: this.page,
      limit: this.limit,
    };

    if (this.searchQuery) {
      this.api
        .get<CustomerResponse>('/customers/search', { query: this.searchQuery })
        .subscribe({
          next: (res) => {
            this.customers = res.data || [];
            this.total = res.meta?.total || this.customers.length;
            this.computeKpis();
            this.loading = false;
          },
          error: () => {
            this.notification.error('Failed to search customers');
            this.loading = false;
          },
        });
    } else {
      this.api.get<CustomerResponse>('/customers', params).subscribe({
        next: (res) => {
          this.customers = res.data || [];
          this.total = res.meta?.total || this.customers.length;
          this.computeKpis();
          this.loading = false;
        },
        error: () => {
          this.notification.error('Failed to load customers');
          this.loading = false;
        },
      });
    }
  }

  private computeKpis(): void {
    this.totalCustomers = this.total;
    const allSpent = this.customers.map((c) => c.totalSpent || 0);
    this.avgSpend =
      allSpent.length > 0
        ? allSpent.reduce((a, b) => a + b, 0) / allSpent.length
        : 0;
    this.totalLoyaltyPoints = this.customers.reduce(
      (sum, c) => sum + (c.loyaltyPoints || 0),
      0
    );
    this.maxSpent = Math.max(...allSpent, 1);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    this.inactiveCount = this.customers.filter((c) => {
      const created = new Date(c.createdAt);
      return created < thirtyDaysAgo && (c.visitCount || 0) <= 1;
    }).length;
  }

  onSearch(query: string): void {
    this.searchQuery = query;
    this.page = 1;
    this.loadCustomers();
  }

  viewCustomer(customer: Customer): void {
    this.router.navigate(['/customers', customer.id]);
  }

  editCustomer(customer: Customer, event: Event): void {
    event.stopPropagation();
    const ref = this.dialog.open(CustomerDialogComponent, {
      data: { customer },
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.loadCustomers();
    });
  }

  addCustomer(): void {
    const ref = this.dialog.open(CustomerDialogComponent, {
      data: { customer: null },
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.loadCustomers();
    });
  }

  loadTopCustomers(): void {
    this.loadingTop = true;
    this.api
      .get<TopCustomerResponse>('/customers/top', { limit: 5, sortBy: this.topSortBy })
      .subscribe({
        next: (res) => {
          this.topCustomers = res.data || [];
          this.loadingTop = false;
        },
        error: () => {
          this.loadingTop = false;
        },
      });
  }

  setTopSortBy(sortBy: 'totalSpent' | 'visitCount' | 'loyaltyPoints'): void {
    if (this.topSortBy === sortBy) return;
    this.topSortBy = sortBy;
    this.loadTopCustomers();
  }

  formatCurrency(value: number): string {
    return this.currencyFormatter.format(value || 0);
  }

  getInitials(customer: Customer): string {
    return (customer.firstName?.charAt(0) || '') + (customer.lastName?.charAt(0) || '');
  }

  getEffectiveTier(customer: Customer): string {
    return customer.loyaltyTier || customer.tier || '';
  }

  getTierLabel(tier: string): string {
    if (!tier) return 'Standard';
    return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
  }

  getTierClasses(tier: string): string {
    const t = (tier || '').toLowerCase();
    switch (t) {
      case 'gold':
      case 'premium':
        return 'bg-tertiary/15 text-tertiary';
      case 'platinum':
      case 'elite':
        return 'bg-primary-container/20 text-primary';
      case 'silver':
        return 'bg-secondary/15 text-secondary';
      default:
        return 'bg-surface-container-high text-on-surface-variant';
    }
  }

  getSpentPercentage(spent: number): number {
    return Math.min((spent / this.maxSpent) * 100, 100);
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  get pages(): number[] {
    const arr: number[] = [];
    const start = Math.max(1, this.page - 2);
    const end = Math.min(this.totalPages, this.page + 2);
    for (let i = start; i <= end; i++) {
      arr.push(i);
    }
    return arr;
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.loadCustomers();
  }

  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }
}
