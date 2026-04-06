import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil, switchMap, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService, User } from '../../core/services/auth.service';
import { UpiQrDialogComponent } from './upi-qr-dialog.component';
import { ReceiptPrintService } from '../../shared/receipt-print.service';

interface ProductVariant {
  // flat fields from POS search endpoint
  variantId?: number;
  id?: number;
  sku: string;
  size?: string;
  color?: string;
  price: number;
  stock?: number;
  productName?: string;
  brand?: string;
  category?: string;
  barcode?: string;
  // nested fields (from other endpoints)
  product?: {
    id: number;
    name: string;
    brand?: { name: string };
  };
  inventory?: { currentStock: number }[];
}

interface CartItem {
  variantId: number;
  barcode: string;
  productName: string;
  brandName: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
  maxStock: number;
}

interface PosSession {
  id: number;
  openedAt: string;
  status: string;
  openingBalance: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
}

@Component({
  selector: 'app-pos-terminal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, UpiQrDialogComponent],
  templateUrl: './pos-terminal.component.html',
})
export class PosTerminalComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

  currentUser: User | null = null;
  session: PosSession | null = null;
  sessionLoading = true;

  searchQuery = '';
  searchResults: ProductVariant[] = [];
  searchLoading = false;
  showSearchResults = false;

  cart: CartItem[] = [];

  discount = 0;
  taxRate = 0.18;

  paymentMethod: 'cash' | 'card' | 'upi' = 'cash';
  cashTendered: number | null = null;

  checkoutLoading = false;
  showUpiDialog = false;
  upiIntent: { intentId: string; qrCodeUrl: string; upiLink: string; amount: number; expiresAt: string } | null = null;
  customerId: number | null = null;
  customerName = '';

  // Customer search
  customerSearchQuery = '';
  customerSearchResults: any[] = [];
  customerSearchLoading = false;
  showCustomerResults = false;
  private customerSearchSubject = new Subject<string>();
  selectedCustomer: any = null;

  constructor(
    private api: ApiService,
    private notify: NotificationService,
    private auth: AuthService,
    private receiptPrint: ReceiptPrintService
  ) {}

  ngOnInit(): void {
    this.currentUser = this.auth.getCurrentUser();
    this.initSession();
    this.setupSearch();
    this.setupCustomerSearch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initSession(): void {
    this.sessionLoading = true;
    this.api
      .get<ApiResponse<PosSession | null>>('/pos/sessions/current')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res.data) {
            this.session = res.data;
            this.sessionLoading = false;
          } else {
            this.openSession();
          }
        },
        error: () => {
          this.openSession();
        },
      });
  }

  private openSession(): void {
    this.api
      .post<ApiResponse<PosSession>>('/pos/sessions', { openingAmount: 0 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.session = res.data;
          this.sessionLoading = false;
          this.notify.success('POS session opened');
        },
        error: (err) => {
          this.sessionLoading = false;
          this.notify.error(
            err.error?.error || 'Failed to open POS session'
          );
        },
      });
  }

  private setupSearch(): void {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query || query.length < 2) {
            this.searchResults = [];
            this.showSearchResults = false;
            return of(null);
          }
          this.searchLoading = true;
          return this.api.get<ApiResponse<ProductVariant[]>>(
            '/pos/products/search',
            { q: query }
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (res) {
            this.searchResults = res.data || [];
            this.showSearchResults = true;
          }
          this.searchLoading = false;
        },
        error: () => {
          this.searchLoading = false;
          this.searchResults = [];
        },
      });
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchQuery);
  }

  // Customer search
  private setupCustomerSearch(): void {
    this.customerSearchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query || query.length < 2) {
            this.customerSearchResults = [];
            this.showCustomerResults = false;
            return of(null);
          }
          this.customerSearchLoading = true;
          return this.api.get<ApiResponse<any[]>>('/customers/search', { query });
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (res) {
            this.customerSearchResults = res.data || [];
            this.showCustomerResults = true;
          }
          this.customerSearchLoading = false;
        },
        error: () => {
          this.customerSearchLoading = false;
          this.customerSearchResults = [];
        },
      });
  }

  onCustomerSearchInput(): void {
    this.customerSearchSubject.next(this.customerSearchQuery);
  }

  selectCustomer(customer: any): void {
    this.selectedCustomer = customer;
    this.customerId = customer.id;
    this.customerSearchQuery = '';
    this.customerSearchResults = [];
    this.showCustomerResults = false;
  }

  clearCustomer(): void {
    this.selectedCustomer = null;
    this.customerId = null;
    this.customerSearchQuery = '';
  }

  closeCustomerResults(): void {
    setTimeout(() => {
      this.showCustomerResults = false;
    }, 200);
  }

  setExactCash(): void {
    this.cashTendered = Math.ceil(this.total);
  }

  addToCart(variant: ProductVariant): void {
    const vid = variant.variantId || variant.id!;
    const existing = this.cart.find((c) => c.variantId === vid);
    const stock = variant.stock ?? variant.inventory?.[0]?.currentStock ?? 999;

    if (existing) {
      if (existing.quantity >= existing.maxStock) {
        this.notify.warning('Maximum stock reached');
        return;
      }
      existing.quantity++;
    } else {
      this.cart.push({
        variantId: vid,
        barcode: variant.barcode || variant.sku || '',
        productName: variant.productName || variant.product?.name || 'Unknown',
        brandName: variant.brand || variant.product?.brand?.name || '',
        size: variant.size || '',
        color: variant.color || '',
        quantity: 1,
        unitPrice: variant.price,
        maxStock: stock,
      });
    }

    this.searchQuery = '';
    this.searchResults = [];
    this.showSearchResults = false;
  }

  removeFromCart(index: number): void {
    this.cart.splice(index, 1);
  }

  incrementQty(item: CartItem): void {
    if (item.quantity < item.maxStock) {
      item.quantity++;
    }
  }

  decrementQty(item: CartItem): void {
    if (item.quantity > 1) {
      item.quantity--;
    }
  }

  get subtotal(): number {
    return this.cart.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
  }

  get taxAmount(): number {
    return (this.subtotal - this.discount) * this.taxRate;
  }

  get total(): number {
    return this.subtotal - this.discount + this.taxAmount;
  }

  get changeDue(): number {
    if (this.paymentMethod !== 'cash' || !this.cashTendered) return 0;
    return Math.max(0, this.cashTendered - this.total);
  }

  get canCheckout(): boolean {
    if (this.cart.length === 0) return false;
    if (this.checkoutLoading) return false;
    if (this.paymentMethod === 'cash' && this.cashTendered !== null && this.cashTendered < this.total) return false;
    return true;
  }

  selectPayment(method: 'cash' | 'card' | 'upi'): void {
    this.paymentMethod = method;
    if (method !== 'cash') {
      this.cashTendered = null;
    }
  }

  completeSale(): void {
    if (!this.canCheckout) return;

    if (this.paymentMethod === 'upi') {
      this.initiateUpiPayment();
      return;
    }

    this.checkoutLoading = true;

    const body: any = {
      items: this.cart.map((item) => ({
        barcode: item.barcode,
        quantity: item.quantity,
      })),
      payments: [
        {
          method: this.paymentMethod,
          amount: this.total,
        },
      ],
    };

    if (this.discount > 0) body.discountAmount = this.discount;
    if (this.customerId) body.customerId = this.customerId;

    this.api
      .post<ApiResponse<any>>('/pos/checkout', body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.checkoutLoading = false;
          const saleId = res.data?.sale?.id || res.data?.id;
          this.notify.success(
            `Sale completed! ${res.data?.saleNumber || ''}`
          );
          if (saleId) {
            this.receiptPrint.printReceipt(saleId);
          }
          this.resetCart();
        },
        error: (err) => {
          this.checkoutLoading = false;
          this.notify.error(
            err.error?.error || 'Checkout failed. Please try again.'
          );
        },
      });
  }

  private initiateUpiPayment(): void {
    this.checkoutLoading = true;

    const body: any = {
      items: this.cart.map((item) => ({ barcode: item.barcode, quantity: item.quantity })),
    };

    if (this.customerId) body.customerId = this.customerId;
    if (this.discount > 0) body.discountAmount = this.discount;

    this.api.post<ApiResponse<any>>('/pos/upi/create', body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.checkoutLoading = false;
          this.upiIntent = res.data;
          this.showUpiDialog = true;
        },
        error: (err) => {
          this.checkoutLoading = false;
          this.notify.error(err.error?.error || 'Failed to create UPI payment');
        },
      });
  }

  onUpiPaymentComplete(event: { saleNumber: string; saleId: number }): void {
    this.showUpiDialog = false;
    this.upiIntent = null;
    this.notify.success('Payment received! Sale: ' + event.saleNumber);
    if (event.saleId) {
      this.receiptPrint.printReceipt(event.saleId);
    }
    this.resetCart();
  }

  onUpiPaymentCancel(): void {
    this.showUpiDialog = false;
    this.upiIntent = null;
  }

  private resetCart(): void {
    this.cart = [];
    this.discount = 0;
    this.cashTendered = null;
    this.paymentMethod = 'cash';
    this.customerId = null;
    this.selectedCustomer = null;
    this.customerSearchQuery = '';
  }

  closeSearchResults(): void {
    setTimeout(() => {
      this.showSearchResults = false;
    }, 200);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  getVariantLabel(variant: ProductVariant): string {
    const parts: string[] = [];
    if (variant.size) parts.push(variant.size);
    if (variant.color) parts.push(variant.color);
    return parts.join(' / ');
  }

  getItemVariantLabel(item: CartItem): string {
    const parts: string[] = [];
    if (item.size) parts.push(item.size);
    if (item.color) parts.push(item.color);
    return parts.join(' / ');
  }
}
