import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { ReturnDialogComponent } from './return-dialog.component';
import { ExchangeDialogComponent } from './exchange-dialog.component';
import { ReceiptPrintService } from '../../shared/receipt-print.service';
import { AuthService } from '../../core/services/auth.service';

interface SaleItem {
  id: number;
  variant?: {
    product?: { name: string; nonReturnable?: boolean; exchangeOnly?: boolean };
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
  agentId?: number | null;
  agent?: { id: number; firstName: string; lastName: string } | null;
  // §1.2 / Bug#4 — per-line "sold as-is" flag set at billing. Blocks refund/
  // return (exchange is still allowed at the POS counter).
  nonReturnable?: boolean;
}

interface SaleReturn {
  id: number;
  items: any[];
  reason?: string;
  condition?: string;
  refundAmount: number;
  createdAt: string;
}

interface ExchangeReturn {
  id: number;
  returnNumber: string;
  total: number | string;
  originalSale?: { id: number; saleNumber: string } | null;
  items: Array<{
    quantity: number;
    unitPrice: number | string;
    condition?: string;
    variant?: { size?: string; color?: string; product?: { name?: string } };
  }>;
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
  taxAmount?: number | string;
  discountAmount?: number | string;
  manualDiscountAmount?: number | string;
  specialDiscountAmount?: number | string;
  loyaltyDiscountAmount?: number | string;
  loyaltyPointsRedeemed?: number;
  payments?: { id?: number; method: string; amount: string | number; referenceNumber?: string; identifier?: string }[];
  paymentMethod?: string;
  status: string;
  createdAt: string;
  notes?: string;
  exchangeCreditAmount?: number | string | null;
  exchangeReturnId?: number | null;
  exchangeReturn?: ExchangeReturn | null;
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
    FormsModule,
    RouterLink,
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
  agents: Array<{ id: number; name: string }> = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notify: NotificationService,
    private receiptPrint: ReceiptPrintService,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadSale(id);
    }
    this.loadAgents();
  }

  private loadAgents(): void {
    this.api.get<any>('/employees').subscribe({
      next: (res: any) => {
        this.agents = (res.data ?? [])
          .filter((e: any) => e.isActive)
          .map((e: any) => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`.trim(),
          }));
      },
    });
  }

  onAgentChange(item: SaleItem, agentId: number | null): void {
    if (!this.sale) return;
    this.api
      .put<any>(`/sales/${this.sale.id}/agents`, {
        items: [{ saleItemId: item.id, agentId }],
      })
      .subscribe({
        next: () => {
          item.agentId = agentId;
          this.notify.success('Agent updated');
        },
        error: () => this.notify.error('Failed to update agent'),
      });
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

  printReceipt(): void {
    if (this.sale) {
      this.receiptPrint.printReceipt(this.sale.id);
    }
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
      return `${this.sale.customer.firstName} ${this.sale.customer.lastName || ''}`.trim();
    }
    return 'Walk-in Customer';
  }

  getCashierName(): string {
    if (this.sale?.user) {
      return `${this.sale.user.firstName} ${this.sale.user.lastName}`.trim();
    }
    return '-';
  }

  // ─── Exchange (return credited against this sale) ───────────────
  get isExchange(): boolean {
    return Number(this.sale?.exchangeCreditAmount) > 0 || !!this.sale?.exchangeReturn;
  }

  get exchangeCredit(): number {
    return Number(this.sale?.exchangeCreditAmount) || 0;
  }

  /** Cash refunded to the customer (credit beyond the new purchase value). */
  get exchangeRefund(): number {
    const r = this.exchangeCredit - Number(this.sale?.total || 0);
    return r > 0 ? Math.round(r * 100) / 100 : 0;
  }

  /** What the customer actually paid for the new items after the credit. */
  get exchangeNetPaid(): number {
    const n = Number(this.sale?.total || 0) - this.exchangeCredit;
    return n > 0 ? Math.round(n * 100) / 100 : 0;
  }

  num(v: unknown): number {
    return Number(v) || 0;
  }

  /** §12 — voucher tenders, for the itemized bill breakup. */
  get voucherPayments(): { id?: number; method: string; amount: string | number; referenceNumber?: string }[] {
    return (this.sale?.payments || []).filter((p) => p.method === 'voucher');
  }

  get canReturn(): boolean {
    return (
      (this.sale?.status === 'completed' || this.sale?.status === 'partially_returned') &&
      this.returnableItems.length > 0
    );
  }

  get returnableItems(): SaleItem[] {
    if (!this.sale) return [];
    // Bug#4 — a line marked non-returnable at billing (or a product flagged
    // non-returnable / exchange-only) can't be refund-returned from the Sales
    // tab. It doesn't appear as a refundable option here; exchange is still
    // available at the POS counter.
    return this.sale.items.filter(
      (item) =>
        (item.returnedQuantity || 0) < item.quantity &&
        !item.nonReturnable &&
        !item.variant?.product?.nonReturnable &&
        !item.variant?.product?.exchangeOnly
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
