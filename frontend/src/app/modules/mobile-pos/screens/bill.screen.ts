import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MobileCartService, MobileCartItem } from '../services/mobile-cart.service';
import { ApiService } from '../../../core/services/api.service';

interface OfferEvalItem {
  variantId: number;
  quantity: number;
  offer: { displayText?: string; [key: string]: any } | null;
  qualified: boolean;
  discountAmount: number;
  hint?: string;
}

type OfferEvalResponse =
  | OfferEvalItem[]
  | { success: boolean; data: OfferEvalItem[] };

interface LoyaltyConfigResponse {
  success?: boolean;
  data?: {
    redemptionValue?: number | string;
    minRedeemPoints?: number | string;
    [key: string]: any;
  };
}

@Component({
  selector: 'app-mobile-bill-screen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen mp-screen--no-nav bill-screen">
        <!-- Sticky header -->
        <header class="mp-header bill-header">
          <button
            type="button"
            class="icon-btn"
            aria-label="Back to cart"
            (click)="goBack()"
          >
            <span class="material-icons">arrow_back</span>
          </button>
          <div class="bill-header__title">
            <div class="mp-header__title">Review Bill</div>
          </div>
          <div class="bill-header__total">
            <div class="bill-header__total-label">Total</div>
            <div class="bill-header__total-amount">{{ formatInr(cart.total()) }}</div>
          </div>
        </header>

        <div class="bill-body">
          <!-- Section 1: Customer -->
          <section class="bill-section">
            @if (cart.customer(); as cust) {
              <div class="mp-card customer-card">
                <div class="customer-card__avatar">
                  {{ initialsFor(cust.firstName, cust.lastName) }}
                </div>
                <div class="customer-card__info">
                  <div class="customer-card__name">
                    {{ cust.firstName }} {{ cust.lastName }}
                  </div>
                  <div class="customer-card__meta">
                    <span class="customer-card__phone">{{ cust.phone }}</span>
                    @if (cust.loyaltyTier) {
                      <span class="mp-chip" [ngClass]="tierClass(cust.loyaltyTier)">
                        {{ cust.loyaltyTier }}
                      </span>
                    }
                  </div>
                  @if (cust.loyaltyPoints != null) {
                    <div class="customer-card__points">
                      {{ cust.loyaltyPoints }} pts available
                    </div>
                  }
                </div>
                <button
                  type="button"
                  class="mp-btn mp-btn--secondary change-btn"
                  (click)="goCustomer()"
                >
                  Change
                </button>
              </div>
            } @else {
              <div class="mp-card no-customer-card">
                <span class="material-icons no-customer-card__icon" aria-hidden="true">
                  person_off
                </span>
                <div class="no-customer-card__label">No customer</div>
                <p class="no-customer-card__sub">
                  Link this bill to a customer to earn loyalty points.
                </p>
                <button
                  type="button"
                  class="mp-btn mp-btn--primary no-customer-card__cta"
                  (click)="goCustomer()"
                >
                  <span class="material-icons" aria-hidden="true">person_add</span>
                  Add Customer
                </button>
              </div>
            }
          </section>

          <!-- Section 2: Line Summary (collapsible) -->
          <section class="bill-section">
            <div class="mp-card line-summary">
              <button
                type="button"
                class="line-summary__header"
                (click)="toggleSummary()"
                [attr.aria-expanded]="summaryExpanded()"
              >
                <div class="line-summary__title">Line Summary</div>
                <span class="material-icons line-summary__chev">
                  {{ summaryExpanded() ? 'expand_less' : 'expand_more' }}
                </span>
              </button>

              <div class="line-summary__row">
                <span class="line-summary__label">Items</span>
                <span class="line-summary__value">
                  {{ cart.count() }} items / {{ cart.items().length }} lines
                </span>
              </div>
              <div class="line-summary__row">
                <span class="line-summary__label">Subtotal</span>
                <span class="line-summary__value">{{ formatInr(cart.subtotal()) }}</span>
              </div>
              @if (cart.offerDiscount() > 0) {
                <div class="line-summary__row line-summary__row--savings">
                  <span class="line-summary__label">Offer Savings</span>
                  <span class="line-summary__value">
                    −{{ formatInr(cart.offerDiscount()) }}
                  </span>
                </div>
              }

              @if (summaryExpanded()) {
                <div class="line-summary__divider"></div>
                <ul class="line-items">
                  @for (item of cart.items(); track item.variantId) {
                    <li class="line-item">
                      <div class="line-item__main">
                        <div class="line-item__name">{{ item.productName }}</div>
                        <div class="line-item__variant">
                          @if (item.size) { <span>{{ item.size }}</span> }
                          @if (item.size && item.color) { <span class="dot">·</span> }
                          @if (item.color) { <span>{{ item.color }}</span> }
                        </div>
                      </div>
                      <div class="line-item__calc">
                        {{ item.quantity }} × {{ formatInr(item.unitPrice) }}
                      </div>
                      <div class="line-item__total">{{ formatInr(lineTotal(item)) }}</div>
                    </li>
                  }
                </ul>
              }
            </div>
          </section>

          <!-- Section 3: Manual Discount -->
          <section class="bill-section">
            <div class="mp-card">
              <div class="section-head">
                <div class="section-head__title">Manual Discount</div>
                <div class="section-head__sub">Discount from the cashier</div>
              </div>

              <div class="mode-toggle">
                <button
                  type="button"
                  class="mp-btn mode-btn"
                  [class.is-active]="cart.manualDiscountMode() === 'amount'"
                  (click)="setDiscountMode('amount')"
                >
                  ₹
                </button>
                <button
                  type="button"
                  class="mp-btn mode-btn"
                  [class.is-active]="cart.manualDiscountMode() === 'percent'"
                  (click)="setDiscountMode('percent')"
                >
                  %
                </button>
              </div>

              <input
                type="number"
                class="mp-input mp-input--numeric"
                inputmode="numeric"
                min="0"
                placeholder="0"
                [ngModel]="cart.manualDiscountValue()"
                (ngModelChange)="onManualDiscountChange($event)"
              />

              @if (cart.manualDiscountMode() === 'percent' && cart.resolvedManualDiscount() > 0) {
                <div class="resolved-hint">
                  = −{{ formatInr(cart.resolvedManualDiscount()) }} on
                  {{ formatInr(cart.discountBase()) }}
                </div>
              }
            </div>
          </section>

          <!-- Section 4: Special Discount -->
          <section class="bill-section">
            <div class="mp-card">
              <div class="section-head">
                <div class="section-head__title">Special Discount (₹)</div>
                <div class="section-head__sub">Customer asks for extra waive</div>
              </div>

              <input
                type="number"
                class="mp-input mp-input--numeric"
                inputmode="numeric"
                min="0"
                placeholder="0"
                [ngModel]="cart.specialDiscount()"
                (ngModelChange)="onSpecialDiscountChange($event)"
              />
            </div>
          </section>

          <!-- Section 5: Round-off -->
          @if (cart.roundDownAmount() > 0 || cart.roundUpAmount() > 0) {
            <section class="bill-section">
              <div class="mp-card">
                <div class="section-head">
                  <div class="section-head__title">Round-off</div>
                  <div class="section-head__sub">
                    Snap total to the nearest ₹10
                  </div>
                </div>

                <div class="round-buttons">
                  <button
                    type="button"
                    class="mp-btn round-btn"
                    [class.is-active]="cart.roundMode() === 'down'"
                    [disabled]="cart.roundDownAmount() === 0"
                    (click)="setRoundMode('down')"
                  >
                    <span class="round-btn__arrow">↓</span>
                    <span>Round −{{ formatInr(cart.roundDownAmount()) }}</span>
                  </button>
                  <button
                    type="button"
                    class="mp-btn round-btn"
                    [class.is-active]="cart.roundMode() === 'up'"
                    [disabled]="cart.roundUpAmount() === 0"
                    (click)="setRoundMode('up')"
                  >
                    <span class="round-btn__arrow">↑</span>
                    <span>Round +{{ formatInr(cart.roundUpAmount()) }}</span>
                  </button>
                </div>

                @if (cart.roundMode() !== 'none') {
                  <div class="round-state">
                    <span class="round-state__label">
                      @if (cart.roundMode() === 'down') {
                        Rounding down — waive {{ formatInr(cart.roundDownAmount()) }}
                      } @else {
                        Rounding up — surcharge {{ formatInr(cart.roundUpAmount()) }}
                      }
                    </span>
                    <button
                      type="button"
                      class="mp-btn mp-btn--ghost round-clear"
                      (click)="setRoundMode('none')"
                    >
                      Clear
                    </button>
                  </div>
                }
              </div>
            </section>
          }

          <!-- Section 6: Loyalty Redemption -->
          @if (cart.customer()) {
            @if ((cart.customer()?.loyaltyPoints ?? 0) >= cart.loyaltyMinRedeem()) {
              <section class="bill-section">
                <div class="mp-card">
                  <div class="section-head">
                    <div class="section-head__title">Redeem Loyalty Points</div>
                    <div class="section-head__sub">
                      {{ cart.customer()?.loyaltyPoints ?? 0 }} points available
                    </div>
                  </div>

                  <input
                    type="number"
                    class="mp-input mp-input--numeric"
                    inputmode="numeric"
                    [attr.min]="cart.loyaltyMinRedeem()"
                    [attr.max]="cart.customer()?.loyaltyPoints ?? 0"
                    placeholder="0"
                    [ngModel]="cart.loyaltyPointsRedeem()"
                    (ngModelChange)="onLoyaltyChange($event)"
                  />

                  @if (cart.loyaltyDiscount() > 0) {
                    <div class="resolved-hint resolved-hint--success">
                      = −{{ formatInr(cart.loyaltyDiscount()) }}
                    </div>
                  }

                  <div class="loyalty-helper">
                    1 point = ₹{{ cart.loyaltyRedemptionValue() }} ·
                    Minimum {{ cart.loyaltyMinRedeem() }} points required
                  </div>
                </div>
              </section>
            } @else if ((cart.customer()?.loyaltyPoints ?? 0) > 0) {
              <section class="bill-section">
                <div class="mp-card loyalty-needs">
                  <span class="material-icons loyalty-needs__icon" aria-hidden="true">
                    loyalty
                  </span>
                  <div class="loyalty-needs__text">
                    Need
                    {{ cart.loyaltyMinRedeem() - (cart.customer()?.loyaltyPoints ?? 0) }}
                    more points to redeem
                  </div>
                </div>
              </section>
            }
          }

          <!-- Section 7: Final Totals -->
          <section class="bill-section">
            <div class="mp-card totals">
              <div class="totals__row">
                <span>Subtotal</span>
                <span>{{ formatInr(cart.subtotal()) }}</span>
              </div>
              @if (cart.offerDiscount() > 0) {
                <div class="totals__row totals__row--savings">
                  <span>Offer savings</span>
                  <span>−{{ formatInr(cart.offerDiscount()) }}</span>
                </div>
              }
              @if (cart.resolvedManualDiscount() > 0) {
                <div class="totals__row totals__row--savings">
                  <span>Manual discount</span>
                  <span>−{{ formatInr(cart.resolvedManualDiscount()) }}</span>
                </div>
              }
              @if ((cart.specialDiscount() ?? 0) > 0) {
                <div class="totals__row totals__row--savings">
                  <span>Special discount</span>
                  <span>−{{ formatInr(cart.specialDiscount() ?? 0) }}</span>
                </div>
              }
              @if (cart.loyaltyDiscount() > 0) {
                <div class="totals__row totals__row--savings">
                  <span>Loyalty redemption</span>
                  <span>−{{ formatInr(cart.loyaltyDiscount()) }}</span>
                </div>
              }
              @if (cart.roundMode() === 'down' && cart.roundDownAmount() > 0) {
                <div class="totals__row totals__row--savings">
                  <span>Round-off</span>
                  <span>−{{ formatInr(cart.roundDownAmount()) }}</span>
                </div>
              }
              @if (cart.roundMode() === 'up' && cart.roundUpAmount() > 0) {
                <div class="totals__row">
                  <span>Round-off</span>
                  <span>+{{ formatInr(cart.roundUpAmount()) }}</span>
                </div>
              }

              <div class="totals__divider"></div>

              <div class="totals__row totals__row--grand">
                <span>Total Payable</span>
                <span>{{ formatInr(cart.total()) }}</span>
              </div>
            </div>
          </section>
        </div>

        <!-- Sticky action bar -->
        <div class="mp-action-bar bill-action-bar">
          <button
            type="button"
            class="mp-btn mp-btn--primary mp-btn--lg mp-btn--block proceed-btn"
            [disabled]="cart.items().length === 0"
            (click)="goPayment()"
          >
            <span>Proceed to Payment</span>
            <span class="proceed-btn__dot">·</span>
            <span>{{ formatInr(cart.total()) }}</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .bill-screen {
      padding-bottom: calc(88px + var(--mp-safe-bottom));
    }

    /* Header */
    .bill-header {
      gap: 12px;
    }

    .icon-btn {
      background: transparent;
      border: 0;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--mp-on-bg);
      cursor: pointer;
    }
    .icon-btn .material-icons { font-size: 24px; }
    .icon-btn:active { background: var(--mp-surface-2); }

    .bill-header__title {
      flex: 1;
      min-width: 0;
    }

    .bill-header__total {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      flex-shrink: 0;
    }

    .bill-header__total-label {
      font-size: 10px;
      color: var(--mp-on-bg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
    }

    .bill-header__total-amount {
      font-size: 14px;
      font-weight: 700;
      color: var(--mp-on-bg);
      letter-spacing: -0.01em;
      line-height: 1.1;
    }

    /* Body */
    .bill-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .bill-section {
      display: block;
    }

    .section-head {
      margin-bottom: 12px;
    }

    .section-head__title {
      font-size: 15px;
      font-weight: 700;
      color: var(--mp-on-bg);
    }

    .section-head__sub {
      font-size: 12px;
      color: var(--mp-on-bg-muted);
      margin-top: 2px;
    }

    /* Customer card */
    .customer-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px;
    }

    .customer-card__avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--mp-primary-soft);
      color: var(--mp-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 15px;
      flex-shrink: 0;
    }

    .customer-card__info {
      flex: 1;
      min-width: 0;
    }

    .customer-card__name {
      font-size: 15px;
      font-weight: 700;
      color: var(--mp-on-bg);
    }

    .customer-card__meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
      flex-wrap: wrap;
    }

    .customer-card__phone {
      font-size: 13px;
      color: var(--mp-on-bg-muted);
    }

    .customer-card__points {
      font-size: 11px;
      color: var(--mp-on-bg-muted);
      font-weight: 600;
      margin-top: 4px;
    }

    .change-btn {
      min-height: 40px;
      padding: 0 14px;
      font-size: 13px;
      border-radius: 12px;
      flex-shrink: 0;
    }

    .no-customer-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 6px;
      padding: 24px 16px;
      border: 2px dashed var(--mp-border);
      background: transparent;
    }

    .no-customer-card__icon {
      font-size: 40px;
      color: var(--mp-on-bg-faint);
      opacity: 0.7;
    }

    .no-customer-card__label {
      font-size: 16px;
      font-weight: 700;
      color: var(--mp-on-bg);
    }

    .no-customer-card__sub {
      font-size: 13px;
      color: var(--mp-on-bg-muted);
      margin: 0 0 6px;
    }

    .no-customer-card__cta {
      margin-top: 4px;
      min-width: 180px;
    }

    /* Line summary */
    .line-summary__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: transparent;
      border: 0;
      padding: 0;
      width: 100%;
      cursor: pointer;
      color: var(--mp-on-bg);
      font-family: inherit;
      margin-bottom: 10px;
    }

    .line-summary__title {
      font-size: 15px;
      font-weight: 700;
    }

    .line-summary__chev {
      color: var(--mp-on-bg-muted);
      font-size: 22px;
    }

    .line-summary__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 14px;
    }

    .line-summary__label {
      color: var(--mp-on-bg-muted);
    }

    .line-summary__value {
      color: var(--mp-on-bg);
      font-weight: 600;
    }

    .line-summary__row--savings .line-summary__value,
    .line-summary__row--savings .line-summary__label {
      color: var(--mp-success);
    }

    .line-summary__divider {
      height: 1px;
      background: var(--mp-border);
      margin: 10px 0;
    }

    .line-items {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .line-item {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
      column-gap: 12px;
      align-items: start;
      font-size: 13px;
    }

    .line-item__main {
      grid-column: 1 / 2;
      grid-row: 1 / 3;
      min-width: 0;
    }

    .line-item__name {
      font-weight: 600;
      color: var(--mp-on-bg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .line-item__variant {
      color: var(--mp-on-bg-muted);
      font-size: 12px;
      display: flex;
      gap: 4px;
      margin-top: 2px;
    }
    .line-item__variant .dot { opacity: 0.6; }

    .line-item__calc {
      grid-column: 2 / 3;
      grid-row: 1 / 2;
      color: var(--mp-on-bg-muted);
      font-size: 12px;
      text-align: right;
    }

    .line-item__total {
      grid-column: 2 / 3;
      grid-row: 2 / 3;
      font-weight: 700;
      text-align: right;
      color: var(--mp-on-bg);
    }

    /* Mode toggle (₹/%) */
    .mode-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }

    .mode-btn {
      min-height: 44px;
      font-size: 16px;
      border-radius: 12px;
      background: var(--mp-surface-2);
      color: var(--mp-on-bg-muted);
      border: 1px solid var(--mp-border);
    }

    .mode-btn.is-active {
      background: var(--mp-primary);
      color: var(--mp-primary-on);
      border-color: var(--mp-primary);
      box-shadow: 0 4px 14px -4px rgba(107, 138, 253, 0.4);
    }

    /* Numeric input tweak */
    .mp-input--numeric {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.01em;
      text-align: left;
    }

    .resolved-hint {
      margin-top: 10px;
      font-size: 13px;
      color: var(--mp-on-bg-muted);
      font-weight: 500;
    }

    .resolved-hint--success {
      color: var(--mp-success);
      font-weight: 700;
      font-size: 15px;
    }

    /* Round-off */
    .round-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .round-btn {
      min-height: 52px;
      font-size: 14px;
      border-radius: 12px;
      background: var(--mp-surface-2);
      color: var(--mp-on-bg);
      border: 1px solid var(--mp-border);
      gap: 6px;
    }

    .round-btn.is-active {
      background: var(--mp-primary-soft);
      border-color: var(--mp-primary);
      color: var(--mp-primary);
    }

    .round-btn__arrow {
      font-size: 16px;
      font-weight: 800;
    }

    .round-state {
      margin-top: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px;
      background: var(--mp-primary-soft);
      border-radius: 12px;
    }

    .round-state__label {
      font-size: 13px;
      color: var(--mp-primary);
      font-weight: 600;
    }

    .round-clear {
      min-height: 36px;
      padding: 0 12px;
      font-size: 12px;
    }

    /* Loyalty helper row */
    .loyalty-helper {
      margin-top: 10px;
      font-size: 12px;
      color: var(--mp-on-bg-muted);
      line-height: 1.5;
    }

    .loyalty-needs {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px;
      background: var(--mp-surface-2);
      border: 1px dashed var(--mp-border);
    }

    .loyalty-needs__icon {
      color: var(--mp-on-bg-faint);
      font-size: 22px;
    }

    .loyalty-needs__text {
      font-size: 13px;
      color: var(--mp-on-bg-muted);
    }

    /* Totals */
    .totals {
      padding: 18px;
    }

    .totals__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 14px;
      color: var(--mp-on-bg);
    }

    .totals__row--savings {
      color: var(--mp-success);
      font-weight: 600;
    }

    .totals__divider {
      height: 1px;
      background: var(--mp-border);
      margin: 10px 0;
    }

    .totals__row--grand {
      font-size: 20px;
      font-weight: 800;
      color: var(--mp-primary);
      letter-spacing: -0.015em;
      padding-top: 6px;
    }

    /* Action bar */
    .bill-action-bar {
      bottom: 0;
    }

    .proceed-btn {
      gap: 6px;
    }

    .proceed-btn__dot {
      opacity: 0.6;
    }

    /* Hide native number spinners */
    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    input[type="number"] {
      -moz-appearance: textfield;
    }
  `],
})
export class MobileBillScreen implements OnInit, OnDestroy {
  readonly cart = inject(MobileCartService);
  private api = inject(ApiService);
  private router = inject(Router);

  // UI state
  readonly summaryExpanded = signal<boolean>(false);

  // Offer re-evaluation (debounced, mirrors cart screen behavior)
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEvalKey = '';
  private readonly cartSignature = computed(() =>
    this.cart
      .items()
      .map((i) => `${i.variantId}x${i.quantity}`)
      .join('|')
  );

  constructor() {
    effect(() => {
      const sig = this.cartSignature();
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      if (!sig) {
        this.lastEvalKey = '';
        return;
      }
      this.debounceTimer = setTimeout(() => this.evaluateOffers(sig), 200);
    });
  }

  ngOnInit(): void {
    // Load loyalty config once per screen mount
    this.api.get<LoyaltyConfigResponse>('/loyalty/config').subscribe({
      next: (res) => {
        const data = (res as any)?.data ?? res ?? {};
        const rv = Number(data?.redemptionValue ?? 1);
        const min = Number(data?.minRedeemPoints ?? 100);
        this.cart.loyaltyRedemptionValue.set(Number.isFinite(rv) && rv > 0 ? rv : 1);
        this.cart.loyaltyMinRedeem.set(Number.isFinite(min) && min > 0 ? min : 100);
      },
      error: () => {
        // Keep defaults silently
      },
    });
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ─── Offer re-evaluation ──────────────────────────────────
  private evaluateOffers(signature: string): void {
    if (signature === this.lastEvalKey) return;
    const snapshot = this.cart.items();
    if (snapshot.length === 0) return;

    const payload = {
      items: snapshot.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
      })),
    };

    this.api.post<OfferEvalResponse>('/pos/cart/evaluate', payload).subscribe({
      next: (resp) => {
        const results: OfferEvalItem[] = Array.isArray(resp)
          ? resp
          : Array.isArray((resp as any)?.data)
          ? (resp as any).data
          : [];

        const byVariant = new Map<number, OfferEvalItem>();
        for (const r of results) {
          if (r && typeof r.variantId === 'number') byVariant.set(r.variantId, r);
        }

        const current = this.cart.items();
        const updated: MobileCartItem[] = current.map((item) => {
          const r = byVariant.get(item.variantId);
          if (!r) {
            return {
              ...item,
              offerDisplay: undefined,
              offerDiscount: undefined,
              offerQualified: false,
            };
          }
          return {
            ...item,
            offerDisplay: r.offer?.displayText ?? r.hint ?? undefined,
            offerDiscount: r.discountAmount ?? 0,
            offerQualified: !!r.qualified,
          };
        });

        this.cart.items.set(updated);
        this.lastEvalKey = signature;
      },
      error: () => {
        // Silent
      },
    });
  }

  // ─── UI handlers ──────────────────────────────────────────
  toggleSummary(): void {
    this.summaryExpanded.update((v) => !v);
  }

  setDiscountMode(mode: 'amount' | 'percent'): void {
    this.cart.manualDiscountMode.set(mode);
  }

  onManualDiscountChange(value: number | null): void {
    const n = value == null || Number.isNaN(Number(value)) ? null : Number(value);
    this.cart.manualDiscountValue.set(n != null && n <= 0 ? null : n);
  }

  onSpecialDiscountChange(value: number | null): void {
    const n = value == null || Number.isNaN(Number(value)) ? null : Number(value);
    this.cart.specialDiscount.set(n != null && n <= 0 ? null : n);
  }

  onLoyaltyChange(value: number | null): void {
    const available = this.cart.customer()?.loyaltyPoints ?? 0;
    let n = value == null || Number.isNaN(Number(value)) ? null : Number(value);
    if (n != null) {
      if (n <= 0) {
        n = null;
      } else if (n > available) {
        n = available;
      }
    }
    this.cart.loyaltyPointsRedeem.set(n);
  }

  setRoundMode(mode: 'none' | 'down' | 'up'): void {
    this.cart.roundMode.set(mode);
  }

  // ─── Navigation ───────────────────────────────────────────
  goBack(): void {
    this.router.navigate(['/mobile-pos/cart']);
  }

  goCustomer(): void {
    this.router.navigate(['/mobile-pos/customer']);
  }

  goPayment(): void {
    if (this.cart.items().length === 0) return;
    this.router.navigate(['/mobile-pos/checkout']);
  }

  // ─── Helpers ──────────────────────────────────────────────
  lineTotal(item: MobileCartItem): number {
    const base = item.unitPrice * item.quantity;
    const discount = item.offerQualified ? item.offerDiscount ?? 0 : 0;
    return Math.max(0, base - discount);
  }

  formatInr(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value || 0);
  }

  initialsFor(first?: string, last?: string): string {
    const a = (first || '').trim().charAt(0).toUpperCase();
    const b = (last || '').trim().charAt(0).toUpperCase();
    return (a + b) || '?';
  }

  tierClass(tier: string | undefined | null): string {
    const t = (tier || '').toLowerCase();
    if (t === 'bronze') return 'mp-tier-bronze';
    if (t === 'silver') return 'mp-tier-silver';
    if (t === 'gold') return 'mp-tier-gold';
    if (t === 'platinum') return 'mp-tier-platinum';
    return 'mp-tier-bronze';
  }
}
