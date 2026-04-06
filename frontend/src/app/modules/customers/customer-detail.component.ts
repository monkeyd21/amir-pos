import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CustomerDialogComponent } from './customer-dialog.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  totalSpent: number;
  loyaltyPoints: number;
  visitCount: number;
  tier: string;
  createdAt: string;
}

interface SaleItem {
  id: number;
  quantity: number;
  unitPrice: number;
  total: number;
  variant?: {
    product?: { name?: string };
    size?: string;
    color?: string;
  };
  productName?: string;
}

interface Sale {
  id: number;
  saleNumber: string;
  totalAmount: number;
  status: string;
  paymentMethod: string;
  createdAt: string;
  items?: SaleItem[];
  returnItems?: any[];
}

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [CommonModule, LoadingSpinnerComponent, StatusBadgeComponent],
  templateUrl: './customer-detail.component.html',
})
export class CustomerDetailComponent implements OnInit {
  customer: Customer | null = null;
  sales: Sale[] = [];
  loading = true;
  salesLoading = true;
  activeTab: 'purchases' | 'returns' = 'purchases';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notification: NotificationService,
    private dialog: DialogService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadCustomer(+id);
      this.loadSales(+id);
    }
  }

  private loadCustomer(id: number): void {
    this.loading = true;
    this.api
      .get<{ success: boolean; data: Customer }>(`/customers/${id}`)
      .subscribe({
        next: (res) => {
          this.customer = res.data;
          this.loading = false;
        },
        error: () => {
          this.notification.error('Failed to load customer');
          this.loading = false;
        },
      });
  }

  private loadSales(customerId: number): void {
    this.salesLoading = true;
    this.api
      .get<{ success: boolean; data: Sale[] }>('/sales', {
        customerId,
        limit: 50,
      })
      .subscribe({
        next: (res) => {
          this.sales = res.data || [];
          this.salesLoading = false;
        },
        error: () => {
          this.salesLoading = false;
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/customers']);
  }

  editProfile(): void {
    if (!this.customer) return;
    const ref = this.dialog.open(CustomerDialogComponent, {
      data: { customer: this.customer },
    });
    ref.afterClosed().subscribe((result) => {
      if (result && this.customer) {
        this.loadCustomer(this.customer.id);
      }
    });
  }

  getInitials(): string {
    if (!this.customer) return '';
    return (
      (this.customer.firstName?.charAt(0) || '') +
      (this.customer.lastName?.charAt(0) || '')
    );
  }

  getTierLabel(tier: string): string {
    if (!tier) return 'Standard';
    return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
  }

  getTierClasses(tier: string): string {
    const t = (tier || '').toLowerCase();
    switch (t) {
      case 'premium':
        return 'bg-tertiary/15 text-tertiary';
      case 'elite':
        return 'bg-primary-container/20 text-primary';
      default:
        return 'bg-surface-container-high text-on-surface-variant';
    }
  }

  setTab(tab: 'purchases' | 'returns'): void {
    this.activeTab = tab;
  }

  get totalOrders(): number {
    return this.sales.length;
  }

  get returnsRate(): number {
    if (this.sales.length === 0) return 0;
    const returned = this.sales.filter(
      (s) =>
        s.status === 'returned' || s.status === 'partially_returned'
    ).length;
    return Math.round((returned / this.sales.length) * 100);
  }

  get returnedSales(): Sale[] {
    return this.sales.filter(
      (s) =>
        s.status === 'returned' || s.status === 'partially_returned'
    );
  }

  getItemsSummary(sale: Sale): string {
    if (!sale.items || sale.items.length === 0) return '-';
    const names = sale.items.map(
      (item) =>
        item.variant?.product?.name || item.productName || 'Item'
    );
    if (names.length <= 2) return names.join(', ');
    return `${names[0]}, ${names[1]} +${names.length - 2} more`;
  }

  formatStatus(value: string): string {
    if (!value) return '';
    return value
      .split('_')
      .map(
        (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join(' ');
  }
}
