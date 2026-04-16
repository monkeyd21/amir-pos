import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MobileCartService, MobileCartItem } from '../services/mobile-cart.service';
import { MobileScannerService } from '../services/mobile-scanner.service';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';

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

interface BarcodeLookup {
  variantId: number;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  price: number;
  productName: string;
  brand?: string;
  stock: number;
}

interface EmployeeLite {
  id: number;
  firstName: string;
  lastName: string;
  isActive?: boolean;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-mobile-cart-screen',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen cart-screen">
        <!-- Header -->
        <header class="mp-header">
          <div>
            <div class="mp-header__title">Cart</div>
            <div class="header-sub">
              @if (cart.count() > 0) {
                {{ cart.count() }} {{ cart.count() === 1 ? 'item' : 'items' }}
              } @else {
                Empty
              }
            </div>
          </div>
          @if (cart.count() > 0) {
            <button type="button" class="mp-btn mp-btn--ghost clear-top" (click)="onClear()">
              <span class="material-icons" aria-hidden="true">delete_sweep</span>
              <span class="clear-label">Clear</span>
            </button>
          }
        </header>

        <div class="cart-body">
          <!-- Customer card -->
          @if (cart.customer(); as cust) {
            <div class="mp-card customer-card" (click)="goCustomer()">
              <div class="customer-card__avatar">
                <span class="material-icons" aria-hidden="true">person</span>
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
                  @if (cust.loyaltyPoints != null) {
                    <span class="customer-card__points">
                      {{ cust.loyaltyPoints }} pts
                    </span>
                  }
                </div>
              </div>
              <span class="material-icons customer-card__chevron" aria-hidden="true">chevron_right</span>
            </div>
          } @else if (cart.count() > 0) {
            <button type="button" class="mp-card add-customer" (click)="goCustomer()">
              <span class="material-icons add-customer__icon" aria-hidden="true">person_add</span>
              <span class="add-customer__label">Add customer</span>
              <span class="material-icons add-customer__chevron" aria-hidden="true">chevron_right</span>
            </button>
          }

          <!-- Items or empty state -->
          @if (cart.items().length === 0) {
            <div class="empty-state">
              <span class="material-icons empty-state__icon" aria-hidden="true">shopping_bag</span>
              <h2 class="empty-state__title">Your cart is empty</h2>
              <p class="empty-state__sub">Scan products to add them</p>
              <button
                type="button"
                class="mp-btn mp-btn--primary mp-btn--lg empty-state__cta"
                (click)="goScan()"
              >
                <span class="material-icons" aria-hidden="true">qr_code_scanner</span>
                <span>Go Scan</span>
              </button>
            </div>
          } @else {
            <ul class="items-list">
              @for (item of cart.items(); track item.variantId) {
                <li
                  class="item-row"
                  [class.is-swiping]="swipingVariantId === item.variantId"
                  [style.transform]="transformFor(item.variantId)"
                  (touchstart)="onTouchStart($event, item.variantId)"
                  (touchmove)="onTouchMove($event, item.variantId)"
                  (touchend)="onTouchEnd($event, item.variantId)"
                  (touchcancel)="onTouchCancel(item.variantId)"
                >
                  <div class="item-row__delete" (click)="onRemove(item.variantId)">
                    <span class="material-icons" aria-hidden="true">delete</span>
                    <span>Delete</span>
                  </div>

                  <div class="mp-card item-card">
                    <div class="item-main">
                      <div class="qty-stepper">
                        <button
                          type="button"
                          class="qty-btn"
                          (click)="onDecrement(item.variantId)"
                          aria-label="Decrease quantity"
                        >
                          <span class="material-icons">remove</span>
                        </button>
                        <div class="qty-value">{{ item.quantity }}</div>
                        <button
                          type="button"
                          class="qty-btn"
                          [disabled]="item.quantity >= item.maxStock"
                          (click)="onIncrement(item.variantId)"
                          aria-label="Increase quantity"
                        >
                          <span class="material-icons">add</span>
                        </button>
                      </div>

                      <div class="item-info">
                        <div class="item-info__name">{{ item.productName }}</div>
                        <div class="item-info__variant">
                          @if (item.size) { <span>{{ item.size }}</span> }
                          @if (item.size && item.color) { <span class="dot">·</span> }
                          @if (item.color) { <span>{{ item.color }}</span> }
                        </div>
                        <div class="item-info__sku">{{ item.sku }}</div>
                      </div>

                      <div class="item-total">
                        <div class="item-total__amount">
                          {{ formatInr(lineTotal(item)) }}
                        </div>
                        @if (item.quantity > 1) {
                          <div class="item-total__unit">
                            {{ formatInr(item.unitPrice) }} each
                          </div>
                        }
                        <button
                          type="button"
                          class="item-trash"
                          (click)="onRemove(item.variantId)"
                          aria-label="Remove item"
                        >
                          <span class="material-icons">delete_outline</span>
                        </button>
                      </div>
                    </div>

                    <!-- Agent dropdown row -->
                    <div class="agent-row">
                      <label class="mp-chip agent-chip">
                        <span class="material-icons agent-chip__icon" aria-hidden="true">badge</span>
                        <span class="agent-chip__label">Agent:</span>
                        <select
                          class="agent-chip__select"
                          [value]="item.agentId ?? ''"
                          (change)="onAgentChange(item.variantId, $event)"
                          aria-label="Assign agent"
                        >
                          <option value="">—</option>
                          @for (emp of employees(); track emp.id) {
                            <option [value]="emp.id">{{ agentLabel(emp) }}</option>
                          }
                        </select>
                      </label>
                    </div>

                    @if (item.offerQualified && item.offerDisplay) {
                      <div class="offer-row">
                        <span class="mp-chip offer-chip">
                          <span class="material-icons offer-chip__icon" aria-hidden="true">local_offer</span>
                          {{ item.offerDisplay }}
                        </span>
                        @if (item.offerDiscount && item.offerDiscount > 0) {
                          <span class="offer-discount">
                            −{{ formatInr(item.offerDiscount) }}
                          </span>
                        }
                      </div>
                    }
                  </div>
                </li>
              }
            </ul>

            <!-- Scan More button (below last item, only when cart has items) -->
            <button
              type="button"
              class="mp-btn mp-btn--secondary mp-btn--block scan-more-btn"
              [disabled]="scanning()"
              (click)="onScanMore()"
            >
              @if (scanning()) {
                <span class="scan-more-btn__spinner" aria-hidden="true"></span>
                <span>Scanning&hellip;</span>
              } @else {
                <span class="material-icons" aria-hidden="true">qr_code_scanner</span>
                <span>Scan More</span>
              }
            </button>
          }
        </div>

        <!-- Sticky action bar -->
        @if (cart.items().length > 0) {
          <div class="mp-action-bar action-bar">
            <button
              type="button"
              class="mp-btn mp-btn--ghost clear-ghost"
              (click)="onClear()"
            >
              <span class="material-icons" aria-hidden="true">delete_sweep</span>
              <span>Clear cart</span>
            </button>

            <div class="action-bar__row">
              <div class="total-block">
                <div class="total-block__label">Total</div>
                <div class="total-block__amount">{{ formatInr(cart.total()) }}</div>
                @if (cart.offerDiscount() > 0) {
                  <div class="total-block__saved">
                    You saved {{ formatInr(cart.offerDiscount()) }}
                  </div>
                }
              </div>

              <button
                type="button"
                class="mp-btn mp-btn--primary mp-btn--lg checkout-btn"
                [disabled]="cart.items().length === 0"
                (click)="goReviewBill()"
              >
                <span class="material-icons" aria-hidden="true">receipt_long</span>
                <span>Review Bill</span>
                <span class="checkout-btn__count">{{ cart.count() }}</span>
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .cart-screen {
      padding-bottom: calc(72px + 168px + var(--mp-safe-bottom));
    }

    .header-sub {
      font-size: 13px;
      color: var(--mp-on-bg-muted);
      margin-top: 2px;
    }

    .clear-top {
      min-height: 44px;
      padding: 0 12px;
      gap: 4px;
      font-size: 13px;
    }
    .clear-top .material-icons { font-size: 20px; }
    .clear-label { font-weight: 600; }

    .cart-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* Scan More (bottom of items list) */
    .scan-more-btn {
      width: 100%;
      min-height: 52px;
      gap: 10px;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.01em;
      margin-top: 8px;
    }
    .scan-more-btn .material-icons { font-size: 22px; }
    .scan-more-btn:disabled { opacity: 0.7; cursor: not-allowed; }

    .scan-more-btn__spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: mp-spin 0.8s linear infinite;
    }

    @keyframes mp-spin {
      to { transform: rotate(360deg); }
    }

    /* Customer card */
    .customer-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      cursor: pointer;
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
      flex-shrink: 0;
    }
    .customer-card__avatar .material-icons { font-size: 24px; }

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
      font-size: 12px;
      color: var(--mp-on-bg-muted);
      font-weight: 600;
    }

    .customer-card__chevron {
      color: var(--mp-on-bg-faint);
      font-size: 24px;
    }

    .add-customer {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: var(--mp-surface);
      color: var(--mp-on-bg);
      text-align: left;
      font-family: inherit;
      cursor: pointer;
      width: 100%;
    }

    .add-customer__icon {
      color: var(--mp-primary);
      font-size: 22px;
    }

    .add-customer__label {
      flex: 1;
      font-size: 15px;
      font-weight: 600;
    }

    .add-customer__chevron {
      color: var(--mp-on-bg-faint);
      font-size: 22px;
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 64px 24px 32px;
      gap: 12px;
    }

    .empty-state__icon {
      font-size: 96px;
      width: 96px;
      height: 96px;
      line-height: 96px;
      color: var(--mp-on-bg-faint);
      opacity: 0.5;
      margin-bottom: 4px;
    }

    .empty-state__title {
      font-size: 20px;
      font-weight: 700;
      margin: 0;
      color: var(--mp-on-bg);
    }

    .empty-state__sub {
      font-size: 14px;
      color: var(--mp-on-bg-muted);
      margin: 0 0 12px;
    }

    .empty-state__cta {
      margin-top: 8px;
      min-width: 200px;
    }

    /* Items list */
    .items-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .item-row {
      position: relative;
      transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
      will-change: transform;
    }

    .item-row.is-swiping {
      transition: none;
    }

    .item-row__delete {
      position: absolute;
      top: 0;
      bottom: 0;
      right: 0;
      width: 100px;
      background: var(--mp-error);
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      cursor: pointer;
      z-index: 0;
    }
    .item-row__delete .material-icons { font-size: 24px; }

    .item-card {
      position: relative;
      padding: 14px;
      z-index: 1;
    }

    .item-main {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    /* Qty stepper */
    .qty-stepper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .qty-btn {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--mp-surface-2);
      color: var(--mp-on-bg);
      border: 1px solid var(--mp-border);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.08s ease;
    }

    .qty-btn:active:not(:disabled) {
      transform: scale(0.92);
    }

    .qty-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .qty-btn .material-icons { font-size: 22px; }

    .qty-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--mp-on-bg);
      min-width: 32px;
      text-align: center;
      padding: 2px 0;
    }

    .item-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .item-info__name {
      font-size: 16px;
      font-weight: 700;
      color: var(--mp-on-bg);
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .item-info__variant {
      font-size: 13px;
      color: var(--mp-on-bg-muted);
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .item-info__variant .dot { opacity: 0.6; }

    .item-info__sku {
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 11px;
      color: var(--mp-on-bg-faint);
      letter-spacing: 0.02em;
    }

    .item-total {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      flex-shrink: 0;
      position: relative;
    }

    .item-total__amount {
      font-size: 16px;
      font-weight: 800;
      color: var(--mp-on-bg);
      letter-spacing: -0.01em;
    }

    .item-total__unit {
      font-size: 11px;
      color: var(--mp-on-bg-faint);
    }

    .item-trash {
      margin-top: 6px;
      background: transparent;
      border: 0;
      color: var(--mp-on-bg-faint);
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .item-trash:active { color: var(--mp-error); }
    .item-trash .material-icons { font-size: 20px; }

    /* Agent dropdown row */
    .agent-row {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed var(--mp-border);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .agent-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--mp-surface-2);
      color: var(--mp-on-bg);
      padding: 4px 10px 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      max-width: 100%;
      cursor: pointer;
    }

    .agent-chip__icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--mp-primary);
    }

    .agent-chip__label {
      color: var(--mp-on-bg-muted);
      font-weight: 600;
    }

    .agent-chip__select {
      background: transparent;
      border: 0;
      outline: none;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      color: var(--mp-on-bg);
      padding: 2px 18px 2px 2px;
      background-image: linear-gradient(45deg, transparent 50%, var(--mp-on-bg-muted) 50%),
        linear-gradient(135deg, var(--mp-on-bg-muted) 50%, transparent 50%);
      background-position: calc(100% - 9px) 50%, calc(100% - 5px) 50%;
      background-size: 4px 4px, 4px 4px;
      background-repeat: no-repeat;
      max-width: 180px;
      cursor: pointer;
    }

    .agent-chip__select:focus {
      outline: 2px solid var(--mp-primary-soft);
      border-radius: 4px;
    }

    /* Offer */
    .offer-row {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed var(--mp-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .offer-chip {
      background: var(--mp-success-soft);
      color: var(--mp-success);
      padding: 5px 10px;
      max-width: 75%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .offer-chip__icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
    }

    .offer-discount {
      font-size: 13px;
      font-weight: 700;
      color: var(--mp-success);
    }

    /* Action bar */
    .action-bar {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .clear-ghost {
      align-self: flex-end;
      min-height: 36px;
      padding: 0 10px;
      font-size: 12px;
      gap: 4px;
      color: var(--mp-on-bg-muted);
    }
    .clear-ghost .material-icons { font-size: 16px; }

    .action-bar__row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .total-block {
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .total-block__label {
      font-size: 12px;
      color: var(--mp-on-bg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
    }

    .total-block__amount {
      font-size: 24px;
      font-weight: 800;
      color: var(--mp-on-bg);
      letter-spacing: -0.015em;
      line-height: 1.1;
    }

    .total-block__saved {
      font-size: 11px;
      color: var(--mp-success);
      font-weight: 600;
      margin-top: 2px;
    }

    .checkout-btn {
      flex: 1;
      gap: 8px;
    }

    .checkout-btn .material-icons { font-size: 20px; }

    .checkout-btn__count {
      background: rgba(255, 255, 255, 0.2);
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      min-width: 28px;
    }
  `],
})
export class MobileCartScreen implements OnInit, OnDestroy {
  readonly cart = inject(MobileCartService);
  private scanner = inject(MobileScannerService);
  private api = inject(ApiService);
  private notify = inject(NotificationService);
  private router = inject(Router);

  // Agents loaded from GET /employees
  readonly employees = signal<EmployeeLite[]>([]);

  // Scan-in-progress indicator
  readonly scanning = signal<boolean>(false);

  swipingVariantId: number | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchDelta = 0;
  private isHorizontalSwipe = false;
  private openVariantId: number | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEvalKey = '';

  // Track cart item signature as a stable string for the effect
  private readonly cartSignature = computed(() =>
    this.cart
      .items()
      .map((i) => `${i.variantId}x${i.quantity}`)
      .join('|')
  );

  constructor() {
    // Evaluate offers on mount + whenever cart changes (debounced)
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
    this.loadEmployees();
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ─── Employees (agents) ────────────────────────────────────
  private loadEmployees(): void {
    this.api
      .get<Envelope<EmployeeLite[] | { employees: EmployeeLite[] }> | EmployeeLite[]>('/employees')
      .subscribe({
        next: (res) => {
          const raw = (res as any)?.data ?? res;
          let list: EmployeeLite[] = [];
          if (Array.isArray(raw)) {
            list = raw as EmployeeLite[];
          } else if (raw && typeof raw === 'object' && Array.isArray((raw as any).employees)) {
            list = (raw as any).employees as EmployeeLite[];
          }
          this.employees.set(list.filter((e) => e && e.isActive === true));
        },
        error: () => {
          this.employees.set([]);
        },
      });
  }

  onAgentChange(variantId: number, ev: Event): void {
    const value = (ev.target as HTMLSelectElement | null)?.value ?? '';
    const agentId = value === '' ? null : Number(value);
    this.cart.setAgent(variantId, Number.isFinite(agentId as number) ? (agentId as number) : null);
  }

  agentLabel(emp: EmployeeLite): string {
    const last = (emp.lastName || '').trim();
    const initial = last ? last.charAt(0).toUpperCase() + '.' : '';
    return `${emp.firstName}${initial ? ' ' + initial : ''}`.trim();
  }

  // ─── Scan More ─────────────────────────────────────────────
  async onScanMore(): Promise<void> {
    if (this.scanning()) return;
    this.scanning.set(true);
    try {
      const { code, error } = await this.scanner.scan();
      if (error) {
        this.notify.error(error);
        return;
      }
      if (!code) return; // cancelled

      await this.lookupAndAdd(code);
    } finally {
      this.scanning.set(false);
    }
  }

  private async lookupAndAdd(code: string): Promise<void> {
    try {
      const res = await new Promise<Envelope<BarcodeLookup>>((resolve, reject) => {
        this.api
          .get<Envelope<BarcodeLookup>>('/pos/lookup/' + encodeURIComponent(code))
          .subscribe({ next: resolve, error: reject });
      });

      const p = res?.data;
      if (!p) {
        this.notify.error('Product not found for barcode ' + code);
        return;
      }

      const result = await this.cart.add({
        variantId: p.variantId,
        barcode: p.barcode,
        sku: p.sku,
        productName: p.productName,
        size: p.size,
        color: p.color,
        unitPrice: Number(p.price),
        maxStock: Number(p.stock),
      });

      if (result === 'out-of-stock') {
        this.notify.warning('Out of stock: ' + p.productName);
        return;
      }
      if (result === 'full') {
        this.notify.warning('Max stock reached for ' + p.productName);
        return;
      }

      // Stay on cart screen, show toast
      this.notify.success('Added: ' + p.productName);
    } catch (err: any) {
      const msg =
        err?.error?.error ||
        err?.error?.message ||
        'Product not found for barcode ' + code;
      this.notify.error(msg);
    }
  }

  // ─── Offer evaluation ──────────────────────────────────────
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

        // Index results by variantId
        const byVariant = new Map<number, OfferEvalItem>();
        for (const r of results) {
          if (r && typeof r.variantId === 'number') {
            byVariant.set(r.variantId, r);
          }
        }

        const current = this.cart.items();
        const updated: MobileCartItem[] = current.map((item) => {
          const r = byVariant.get(item.variantId);
          if (!r) {
            // No offer info for this item — clear any stale offer fields
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
        // Silent — offer evaluation is best-effort
      },
    });
  }

  // ─── Cart operations ───────────────────────────────────────
  onIncrement(variantId: number): void {
    this.cart.increment(variantId);
  }

  onDecrement(variantId: number): void {
    this.cart.decrement(variantId);
  }

  onRemove(variantId: number): void {
    this.cart.remove(variantId);
    if (this.openVariantId === variantId) {
      this.openVariantId = null;
    }
  }

  onClear(): void {
    if (this.cart.items().length === 0) return;
    this.cart.clear();
    this.openVariantId = null;
  }

  // ─── Swipe-to-delete ───────────────────────────────────────
  onTouchStart(ev: TouchEvent, variantId: number): void {
    if (ev.touches.length !== 1) return;
    const t = ev.touches[0];
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
    this.touchDelta = this.openVariantId === variantId ? -100 : 0;
    this.isHorizontalSwipe = false;
    this.swipingVariantId = variantId;
  }

  onTouchMove(ev: TouchEvent, variantId: number): void {
    if (this.swipingVariantId !== variantId || ev.touches.length !== 1) return;
    const t = ev.touches[0];
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;

    // Detect horizontal intent
    if (!this.isHorizontalSwipe) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        this.isHorizontalSwipe = true;
      } else if (Math.abs(dy) > 10) {
        // It's a vertical scroll — abort
        this.swipingVariantId = null;
        return;
      } else {
        return;
      }
    }

    // Base from current open state
    const base = this.openVariantId === variantId ? -100 : 0;
    let next = base + dx;
    if (next > 0) next = 0;
    if (next < -140) next = -140;
    this.touchDelta = next;
  }

  onTouchEnd(ev: TouchEvent, variantId: number): void {
    if (this.swipingVariantId !== variantId) return;
    if (!this.isHorizontalSwipe) {
      this.swipingVariantId = null;
      return;
    }

    if (this.touchDelta < -80) {
      this.openVariantId = variantId;
      this.touchDelta = -100;
    } else {
      this.openVariantId = null;
      this.touchDelta = 0;
    }
    this.swipingVariantId = null;
  }

  onTouchCancel(variantId: number): void {
    if (this.swipingVariantId !== variantId) return;
    this.touchDelta = this.openVariantId === variantId ? -100 : 0;
    this.swipingVariantId = null;
  }

  transformFor(variantId: number): string {
    if (this.swipingVariantId === variantId) {
      return `translateX(${this.touchDelta}px)`;
    }
    if (this.openVariantId === variantId) {
      return 'translateX(-100px)';
    }
    return 'translateX(0)';
  }

  // ─── Navigation ────────────────────────────────────────────
  goReviewBill(): void {
    if (this.cart.items().length === 0) return;
    this.router.navigate(['/mobile-pos/bill']);
  }

  goCustomer(): void {
    this.router.navigate(['/mobile-pos/customer']);
  }

  goScan(): void {
    this.router.navigate(['/mobile-pos/home']);
  }

  // ─── Helpers ───────────────────────────────────────────────
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

  tierClass(tier: string | undefined | null): string {
    const t = (tier || '').toLowerCase();
    if (t === 'bronze') return 'mp-tier-bronze';
    if (t === 'silver') return 'mp-tier-silver';
    if (t === 'gold') return 'mp-tier-gold';
    if (t === 'platinum') return 'mp-tier-platinum';
    return 'mp-tier-bronze';
  }
}
