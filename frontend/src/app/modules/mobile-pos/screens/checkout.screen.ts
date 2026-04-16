import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MobileCartService } from '../services/mobile-cart.service';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';

type PaymentMethod = 'cash' | 'card' | 'upi';

interface CheckoutResponse {
  success: boolean;
  data: {
    sale?: {
      id: number;
      saleNumber: string;
      total?: number;
      [key: string]: unknown;
    };
    id?: number;
    saleNumber?: string;
    total?: number;
    [key: string]: unknown;
  };
}

@Component({
  selector: 'app-mobile-checkout-screen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen mp-screen--no-nav checkout-screen">
        <!-- Sticky header -->
        <header class="mp-header">
          <button
            type="button"
            class="icon-btn"
            (click)="back()"
            [disabled]="processing()"
            aria-label="Back"
          >
            <span class="material-icons">arrow_back</span>
          </button>
          <h1 class="mp-header__title">Payment</h1>
          <div class="header-total">{{ formatCurrency(cart.total()) }}</div>
        </header>

        <div class="checkout-body">
          <!-- Payment method -->
          <section class="section">
            <h2 class="section-title">Payment Method</h2>
            <div class="pay-grid">
              <button
                type="button"
                class="pay-tile"
                [attr.data-selected]="cart.paymentMethod() === 'cash'"
                (click)="selectMethod('cash')"
              >
                <span class="material-icons pay-tile__icon">payments</span>
                <span class="pay-tile__label">Cash</span>
              </button>
              <button
                type="button"
                class="pay-tile"
                [attr.data-selected]="cart.paymentMethod() === 'card'"
                (click)="selectMethod('card')"
              >
                <span class="material-icons pay-tile__icon">credit_card</span>
                <span class="pay-tile__label">Card</span>
              </button>
              <button
                type="button"
                class="pay-tile"
                [attr.data-selected]="cart.paymentMethod() === 'upi'"
                (click)="selectMethod('upi')"
              >
                <span class="material-icons pay-tile__icon">qr_code_2</span>
                <span class="pay-tile__label">UPI</span>
              </button>
            </div>
          </section>

          <!-- Cash tendered (cash only) -->
          @if (cart.paymentMethod() === 'cash') {
            <section class="section">
              <h2 class="section-title">Cash Tendered</h2>

              <div class="cash-input-wrap">
                <span class="cash-prefix">&#8377;</span>
                <input
                  class="mp-input cash-input"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="1"
                  placeholder="0"
                  [ngModel]="cart.cashTendered()"
                  (ngModelChange)="onCashChange($event)"
                />
              </div>

              <div class="quick-grid">
                @for (amt of quickAmounts; track amt) {
                  <button
                    type="button"
                    class="quick-btn"
                    (click)="setCash(amt)"
                  >
                    {{ formatCurrency(amt) }}
                  </button>
                }
                <button
                  type="button"
                  class="quick-btn quick-btn--exact"
                  (click)="setCash(cart.total())"
                >
                  EXACT
                </button>
              </div>

              @if ((cart.cashTendered() ?? 0) >= cart.total() && cart.total() > 0) {
                <div class="change-box mp-success-soft">
                  <span class="material-icons change-box__icon">check_circle</span>
                  <span>Change due: <strong>{{ formatCurrency(cart.changeDue()) }}</strong></span>
                </div>
              }
            </section>
          }
        </div>

        <!-- Sticky bottom action bar -->
        <div class="mp-action-bar checkout-action-bar">
          <button
            type="button"
            class="mp-btn mp-btn--primary mp-btn--block mp-btn--lg"
            [disabled]="!canComplete() || processing()"
            (click)="completeSale()"
          >
            @if (processing()) {
              <span class="spinner" aria-hidden="true"></span>
              <span>Processing&hellip;</span>
            } @else {
              <span>Complete Sale &middot; {{ formatCurrency(cart.total()) }}</span>
            }
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .checkout-screen {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    .icon-btn {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: transparent;
      color: var(--mp-on-bg);
      border: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;

      &:disabled {
        opacity: 0.4;
      }

      .material-icons {
        font-size: 26px;
      }
    }

    .header-total {
      font-size: 17px;
      font-weight: 700;
      color: var(--mp-on-bg);
      letter-spacing: -0.01em;
    }

    .checkout-body {
      flex: 1;
      padding: 16px 16px 120px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--mp-on-bg-muted);
      margin: 0;
      padding-left: 4px;
    }

    .pay-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }

    .pay-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 88px;
      padding: 12px 8px;
      border-radius: 18px;
      background: var(--mp-surface);
      border: 2px solid var(--mp-border);
      color: var(--mp-on-bg);
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease;

      &:active {
        transform: scale(0.97);
      }

      &[data-selected="true"] {
        border-color: var(--mp-primary);
        box-shadow: 0 0 0 4px var(--mp-primary-soft), 0 6px 20px -6px rgba(107, 138, 253, 0.4);
        color: var(--mp-primary);
      }
    }

    .pay-tile__icon {
      font-size: 30px;
    }

    .pay-tile__label {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .cash-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .cash-prefix {
      position: absolute;
      left: 20px;
      font-size: 22px;
      font-weight: 700;
      color: var(--mp-on-bg-muted);
      pointer-events: none;
    }

    .cash-input {
      min-height: 64px;
      padding-left: 44px;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .quick-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }

    .quick-btn {
      min-height: 48px;
      border-radius: 14px;
      background: var(--mp-surface-2);
      border: 1px solid var(--mp-border);
      color: var(--mp-on-bg);
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.08s ease, background 0.15s ease;

      &:active {
        transform: scale(0.96);
      }
    }

    .quick-btn--exact {
      background: var(--mp-primary-soft);
      color: var(--mp-primary);
      border-color: transparent;
      letter-spacing: 0.06em;
    }

    .change-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 14px;
      color: var(--mp-success);
      font-size: 15px;
      font-weight: 600;
    }

    .change-box__icon {
      font-size: 22px;
    }

    .mp-success-soft {
      background: var(--mp-success-soft);
    }

    .checkout-action-bar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 12px 16px calc(12px + var(--mp-safe-bottom));
      background: var(--mp-surface);
      border-top: 1px solid var(--mp-border);
      z-index: 30;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2.5px solid rgba(255, 255, 255, 0.35);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: mp-spin 0.7s linear infinite;
    }

    @keyframes mp-spin {
      to { transform: rotate(360deg); }
    }
  `],
})
export class MobileCheckoutScreen implements OnInit {
  cart = inject(MobileCartService);
  private router = inject(Router);
  private api = inject(ApiService);
  private notify = inject(NotificationService);

  readonly processing = signal(false);

  readonly quickAmounts = [100, 200, 500, 1000, 2000, 5000];

  readonly canComplete = computed(() => {
    if (this.cart.items().length === 0) return false;
    if (this.cart.paymentMethod() === 'cash') {
      const tendered = this.cart.cashTendered() ?? 0;
      return tendered >= this.cart.total();
    }
    return true;
  });

  ngOnInit(): void {
    if (this.cart.items().length === 0) {
      this.router.navigate(['/mobile-pos/home']);
    }
  }

  back(): void {
    this.router.navigate(['/mobile-pos/bill']);
  }

  selectMethod(method: PaymentMethod): void {
    this.cart.paymentMethod.set(method);
    if (method !== 'cash') {
      this.cart.cashTendered.set(null);
    }
  }

  onCashChange(value: number | string | null): void {
    if (value === null || value === '' || value === undefined) {
      this.cart.cashTendered.set(null);
      return;
    }
    const num = typeof value === 'number' ? value : Number(value);
    this.cart.cashTendered.set(Number.isFinite(num) ? num : null);
  }

  setCash(amount: number): void {
    this.cart.cashTendered.set(amount);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value || 0);
  }

  completeSale(): void {
    if (!this.canComplete() || this.processing()) return;

    this.processing.set(true);

    const body: {
      items: { barcode: string; quantity: number; agentId?: number }[];
      customerId?: number;
      payments: { method: PaymentMethod; amount: number; referenceNumber?: string }[];
      discountAmount?: number;
      loyaltyPointsRedeem?: number;
    } = {
      items: this.cart.items().map((i) => ({
        barcode: i.barcode,
        quantity: i.quantity,
        agentId: i.agentId ?? undefined,
      })),
      payments: [
        {
          method: this.cart.paymentMethod(),
          amount: this.cart.total(),
        },
      ],
    };

    const customer = this.cart.customer();
    if (customer?.id) {
      body.customerId = customer.id;
    }

    if (this.cart.manualDiscount() !== 0) {
      body.discountAmount = this.cart.manualDiscount();
    }

    const pts = Math.min(
      this.cart.loyaltyPointsRedeem() ?? 0,
      this.cart.customer()?.loyaltyPoints ?? 0,
    );
    if (pts > 0) {
      body.loyaltyPointsRedeem = pts;
    }

    this.api.post<CheckoutResponse>('/pos/checkout', body).subscribe({
      next: (res) => {
        const data = res?.data;
        if (!data) {
          this.processing.set(false);
          this.notify.error('Checkout failed: unexpected response.');
          return;
        }
        const sale = data.sale ?? { id: data.id, saleNumber: data.saleNumber };
        const saleNumber = sale?.saleNumber;
        const saleId = sale?.id;
        const total = this.cart.total();
        const cust = this.cart.customer();
        this.cart.clear();
        this.processing.set(false);
        this.router.navigate(['/mobile-pos/success'], {
          queryParams: {
            sale: saleNumber,
            id: saleId,
            total,
            customerId: cust?.id,
            customerPhone: cust?.phone,
            customerName: cust ? `${cust.firstName} ${cust.lastName}` : undefined,
          },
        });
      },
      error: (err) => {
        this.processing.set(false);
        const message =
          err?.error?.error ||
          err?.error?.message ||
          err?.message ||
          'Checkout failed. Please try again.';
        this.notify.error(message);
      },
    });
  }
}
