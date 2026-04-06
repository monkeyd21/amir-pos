import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { ReturnDialogComponent } from './return-dialog.component';
import { ExchangeDialogComponent } from './exchange-dialog.component';

interface SaleItem {
  id: number;
  variant?: {
    product?: { name: string };
    size?: string;
    color?: string;
    sku?: string;
  };
  productName?: string;
  name?: string;
  quantity: number;
  unitPrice: number;
  subtotal?: number;
  returnedQuantity?: number;
}

interface SaleReturn {
  id: number;
  items: any[];
  reason?: string;
  condition?: string;
  refundAmount: number;
  createdAt: string;
}

interface Sale {
  id: number;
  saleNumber: string;
  customer: { id: number; firstName: string; lastName: string; email?: string; phone?: string } | null;
  user: { firstName: string; lastName: string } | null;
  items: SaleItem[];
  returns: SaleReturn[];
  total: number;
  subtotal?: number;
  payments?: { method: string; amount: string | number }[];
  paymentMethod?: string;
  status: string;
  createdAt: string;
  notes?: string;
}

interface SaleResponse {
  success: boolean;
  data: Sale;
}

@Component({
  selector: 'app-sale-detail',
  standalone: true,
  imports: [
    CommonModule,
    StatusBadgeComponent,
    LoadingSpinnerComponent,
    ReturnDialogComponent,
    ExchangeDialogComponent,
  ],
  templateUrl: './sale-detail.component.html',
})
export class SaleDetailComponent implements OnInit {
  sale: Sale | null = null;
  loading = true;
  showReturnDialog = false;
  showExchangeDialog = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadSale(id);
    }
  }

  loadSale(id: string): void {
    this.loading = true;
    this.api.get<SaleResponse>(`/sales/${id}`).subscribe({
      next: (res) => {
        this.sale = res.data;
        this.loading = false;
      },
      error: () => {
        this.notify.error('Failed to load sale details');
        this.loading = false;
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/sales']);
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatStatus(value: string): string {
    if (!value) return '';
    return value
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  getPaymentMethod(): string {
    if (!this.sale) return '';
    return this.sale.payments?.[0]?.method || this.sale.paymentMethod || '';
  }

  formatPaymentMethod(method: string): string {
    if (!method) return '-';
    return method.toUpperCase();
  }

  getProductName(item: SaleItem): string {
    return item.variant?.product?.name || item.productName || item.name || 'Unknown Product';
  }

  getItemSubtotal(item: SaleItem): number {
    return item.subtotal || item.unitPrice * item.quantity;
  }

  getCustomerName(): string {
    if (this.sale?.customer) {
      return `${this.sale.customer.firstName} ${this.sale.customer.lastName}`.trim();
    }
    return 'Walk-in Customer';
  }

  getCashierName(): string {
    if (this.sale?.user) {
      return `${this.sale.user.firstName} ${this.sale.user.lastName}`.trim();
    }
    return '-';
  }

  get canReturn(): boolean {
    return this.sale?.status === 'completed' || this.sale?.status === 'partially_returned';
  }

  get returnableItems(): SaleItem[] {
    if (!this.sale) return [];
    return this.sale.items.filter(
      (item) => (item.returnedQuantity || 0) < item.quantity
    );
  }

  openReturnDialog(): void {
    this.showReturnDialog = true;
  }

  closeReturnDialog(): void {
    this.showReturnDialog = false;
  }

  openExchangeDialog(): void {
    this.showExchangeDialog = true;
  }

  closeExchangeDialog(): void {
    this.showExchangeDialog = false;
  }

  onReturnComplete(): void {
    this.showReturnDialog = false;
    this.notify.success('Return processed successfully');
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadSale(id);
  }

  onExchangeComplete(): void {
    this.showExchangeDialog = false;
    this.notify.success('Exchange processed successfully');
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadSale(id);
  }
}
