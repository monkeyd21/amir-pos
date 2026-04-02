import { Component, OnInit, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTabsModule } from '@angular/material/tabs';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { debounceTime, switchMap, of, catchError } from 'rxjs';
import { PosService, CartItem, PaymentLine, HeldTransaction } from './pos.service';

@Component({
  selector: 'app-pos-terminal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatTabsModule,
    MatBadgeModule,
    MatDividerModule,
    MatSnackBarModule,
    MatAutocompleteModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatSidenavModule,
    MatListModule,
    MatSelectModule,
  ],
  templateUrl: './pos-terminal.component.html',
})
export class PosTerminalComponent implements OnInit {
  @ViewChild('barcodeInput') barcodeInput!: ElementRef<HTMLInputElement>;

  Math = Math;

  private posService = inject(PosService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  // Cart
  cartItems: CartItem[] = [];
  displayedColumns = ['name', 'variant', 'unitPrice', 'quantity', 'total', 'actions'];

  // Totals
  subtotal = 0;
  taxRate = 0.18;
  taxAmount = 0;
  discountAmount = 0;
  discountType: 'flat' | 'percent' = 'percent';
  discountValue = 0;
  total = 0;

  // Customer
  customerSearchCtrl = new FormControl('');
  customerResults: any[] = [];
  selectedCustomer: any = null;
  loyaltyPoints = 0;
  redeemLoyalty = false;
  loyaltyDiscount = 0;

  // Payment
  paymentTabIndex = 0;
  cashAmount = 0;
  cardAmount = 0;
  upiAmount = 0;
  cardReference = '';
  upiReference = '';
  changeDue = 0;

  // Held
  heldTransactions: HeldTransaction[] = [];
  showHeldPanel = false;

  // Barcode & Product Search
  barcodeValue = '';
  loading = false;
  productResults: any[] = [];
  private searchTimeout: any;

  ngOnInit(): void {
    this.ensureSession();
    this.setupCustomerSearch();
    this.loadHeldTransactions();
    this.focusBarcode();
  }

  private ensureSession(): void {
    this.posService.getSession().subscribe({
      next: (session) => {
        if (!session) {
          this.posService.openSession({ openingAmount: 0 }).subscribe();
        }
      },
      error: () => {
        this.posService.openSession({ openingAmount: 0 }).subscribe();
      }
    });
  }

  private setupCustomerSearch(): void {
    this.customerSearchCtrl.valueChanges
      .pipe(
        debounceTime(300),
        switchMap((query) => {
          if (!query || (query as string).length < 2) return of([]);
          return this.posService.searchCustomer(query as string).pipe(catchError(() => of([])));
        })
      )
      .subscribe((results: any) => {
        this.customerResults = Array.isArray(results) ? results : results?.data || [];
      });
  }

  focusBarcode(): void {
    setTimeout(() => {
      if (this.barcodeInput) {
        this.barcodeInput.nativeElement.focus();
      }
    }, 100);
  }

  onSearchInput(): void {
    const query = this.barcodeValue.trim();
    clearTimeout(this.searchTimeout);

    // Only search if it looks like a product name (not a barcode)
    if (!query || query.length < 2 || /^\d+$/.test(query)) {
      this.productResults = [];
      return;
    }

    this.searchTimeout = setTimeout(() => {
      this.posService.searchProducts(query).subscribe({
        next: (results) => {
          this.productResults = results || [];
        },
        error: () => {
          this.productResults = [];
        }
      });
    }, 300);
  }

  onProductSelected(product: any): void {
    this.productResults = [];
    this.addToCart(product, product.barcode);
    this.barcodeValue = '';
    this.focusBarcode();
  }

  onBarcodeScan(): void {
    const barcode = this.barcodeValue.trim();
    if (!barcode) return;

    this.loading = true;
    this.posService.lookupBarcode(barcode).subscribe({
      next: (res) => {
        const product = res;
        this.addToCart(product, barcode);
        this.barcodeValue = '';
        this.loading = false;
        this.focusBarcode();
      },
      error: () => {
        this.snackBar.open('Product not found', 'Close', { duration: 3000 });
        this.barcodeValue = '';
        this.loading = false;
        this.focusBarcode();
      },
    });
  }

  addToCart(product: any, barcode: string): void {
    const existingIndex = this.cartItems.findIndex((item) => item.barcode === barcode);

    if (existingIndex >= 0) {
      this.cartItems[existingIndex].quantity += 1;
      this.cartItems[existingIndex].total =
        this.cartItems[existingIndex].quantity * this.cartItems[existingIndex].unitPrice;
    } else {
      const item: CartItem = {
        productId: product.productId || product.id,
        variantId: product.variantId || product.variant?.id,
        barcode: barcode,
        name: product.name || product.productName,
        variant: product.variantName || `${product.size || ''} / ${product.color || ''}`,
        size: product.size || '',
        color: product.color || '',
        unitPrice: product.price || product.sellingPrice || 0,
        quantity: 1,
        discount: 0,
        total: product.price || product.sellingPrice || 0,
      };
      this.cartItems = [...this.cartItems, item];
    }
    this.recalculate();
  }

  updateQuantity(index: number, delta: number): void {
    const item = this.cartItems[index];
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      this.removeItem(index);
      return;
    }
    item.quantity = newQty;
    item.total = item.quantity * item.unitPrice;
    this.cartItems = [...this.cartItems];
    this.recalculate();
  }

  removeItem(index: number): void {
    this.cartItems.splice(index, 1);
    this.cartItems = [...this.cartItems];
    this.recalculate();
  }

  recalculate(): void {
    this.subtotal = this.cartItems.reduce((sum, item) => sum + item.total, 0);

    if (this.discountType === 'percent') {
      this.discountAmount = (this.subtotal * this.discountValue) / 100;
    } else {
      this.discountAmount = this.discountValue;
    }

    const afterDiscount = this.subtotal - this.discountAmount;
    this.taxAmount = afterDiscount * this.taxRate;

    if (this.redeemLoyalty && this.selectedCustomer) {
      this.loyaltyDiscount = Math.min(this.loyaltyPoints, afterDiscount + this.taxAmount);
    } else {
      this.loyaltyDiscount = 0;
    }

    this.total = afterDiscount + this.taxAmount - this.loyaltyDiscount;
    this.calculateChange();
  }

  onDiscountChange(): void {
    this.recalculate();
  }

  selectCustomer(customer: any): void {
    this.selectedCustomer = customer;
    this.loyaltyPoints = customer.loyaltyPoints || 0;
    this.customerSearchCtrl.setValue(`${customer.firstName} ${customer.lastName}`);
    this.recalculate();
  }

  clearCustomer(): void {
    this.selectedCustomer = null;
    this.loyaltyPoints = 0;
    this.redeemLoyalty = false;
    this.customerSearchCtrl.setValue('');
    this.recalculate();
  }

  onPaymentTabChange(index: number): void {
    this.paymentTabIndex = index;
  }

  calculateChange(): void {
    const totalPaid = this.cashAmount + this.cardAmount + this.upiAmount;
    this.changeDue = Math.max(0, totalPaid - this.total);
  }

  get totalPaid(): number {
    return this.cashAmount + this.cardAmount + this.upiAmount;
  }

  get paymentComplete(): boolean {
    return this.totalPaid >= this.total && this.total > 0;
  }

  checkout(): void {
    if (!this.paymentComplete) {
      this.snackBar.open('Payment incomplete', 'Close', { duration: 3000 });
      return;
    }

    const payments: PaymentLine[] = [];
    if (this.cashAmount > 0) payments.push({ method: 'cash', amount: this.cashAmount });
    if (this.cardAmount > 0) payments.push({ method: 'card', amount: this.cardAmount, reference: this.cardReference });
    if (this.upiAmount > 0) payments.push({ method: 'upi', amount: this.upiAmount, reference: this.upiReference });

    const payload = {
      items: this.cartItems,
      customerId: this.selectedCustomer?.id,
      payments,
      subtotal: this.subtotal,
      taxAmount: this.taxAmount,
      discountAmount: this.discountAmount + this.loyaltyDiscount,
      total: this.total,
      loyaltyPointsRedeemed: this.redeemLoyalty ? this.loyaltyDiscount : 0,
    };

    this.loading = true;
    this.posService.checkout(payload).subscribe({
      next: (res) => {
        this.snackBar.open('Sale completed successfully!', 'Close', { duration: 3000 });
        this.clearCart();
        this.loading = false;
      },
      error: (err) => {
        this.snackBar.open('Checkout failed: ' + (err.error?.message || 'Unknown error'), 'Close', {
          duration: 5000,
        });
        this.loading = false;
      },
    });
  }

  holdCart(): void {
    if (this.cartItems.length === 0) return;

    const transaction = {
      items: this.cartItems,
      customerId: this.selectedCustomer?.id,
      customerName: this.selectedCustomer?.name,
      subtotal: this.subtotal,
      tax: this.taxAmount,
      discount: this.discountAmount,
      total: this.total,
    };

    this.posService.holdTransaction(transaction).subscribe({
      next: () => {
        this.snackBar.open('Transaction held', 'Close', { duration: 2000 });
        this.clearCart();
        this.loadHeldTransactions();
      },
      error: () => {
        this.snackBar.open('Failed to hold transaction', 'Close', { duration: 3000 });
      },
    });
  }

  loadHeldTransactions(): void {
    this.posService.getHeldTransactions().subscribe({
      next: (res) => {
        this.heldTransactions = Array.isArray(res) ? res : [];
      },
      error: () => {},
    });
  }

  resumeHeld(held: HeldTransaction): void {
    this.cartItems = [...held.items];
    if (held.customerId) {
      this.selectedCustomer = { id: held.customerId, name: held.customerName };
      this.customerSearchCtrl.setValue(held.customerName || '');
    }
    this.recalculate();
    this.showHeldPanel = false;

    this.posService.deleteHeldTransaction(held.id).subscribe({
      next: () => this.loadHeldTransactions(),
    });
  }

  deleteHeld(held: HeldTransaction): void {
    this.posService.deleteHeldTransaction(held.id).subscribe({
      next: () => {
        this.loadHeldTransactions();
        this.snackBar.open('Held transaction deleted', 'Close', { duration: 2000 });
      },
    });
  }

  clearCart(): void {
    this.cartItems = [];
    this.selectedCustomer = null;
    this.loyaltyPoints = 0;
    this.redeemLoyalty = false;
    this.customerSearchCtrl.setValue('');
    this.discountValue = 0;
    this.discountAmount = 0;
    this.cashAmount = 0;
    this.cardAmount = 0;
    this.upiAmount = 0;
    this.cardReference = '';
    this.upiReference = '';
    this.changeDue = 0;
    this.recalculate();
    this.focusBarcode();
  }

  exitPos(): void {
    this.router.navigate(['/']);
  }
}
