import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, switchMap, of, catchError } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReasonPickerComponent } from '../components/reason-picker.component';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MobileScannerService } from '../services/mobile-scanner.service';
import { OfflineService } from '../../../core/services/offline.service';

type Condition = 'resellable' | 'damaged';

interface SaleItemVariant {
  size?: string | null;
  color?: string | null;
  sku?: string | null;
  product?: { name?: string | null } | null;
}

interface SaleItem {
  id: number;
  variantId?: number;
  quantity: number | string;
  unitPrice: number | string;
  effectiveUnitPrice?: number | string | null;
  returnedQuantity: number | string;
  variant?: SaleItemVariant | null;
}

interface SaleCustomer {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** §0: the swap this bill has already had. Null when it still has its one. */
interface PriorExchange {
  id: number;
  returnNumber: string;
  createdAt: string;
  dateLabel: string;
}

interface Sale {
  id: number;
  saleNumber: string;
  status: string;
  items: SaleItem[];
  customer?: SaleCustomer | null;
  priorExchange?: PriorExchange | null;
}

interface OverrideApproval {
  grant: string;
  approverName: string;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
}

interface BarcodeLookup {
  variantId: number;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  price: number | string;
  /** Tag MRP — what the label says before the shop's markdown. The lookup has
   *  always returned it; the mobile POS just never carried it through. */
  mrp?: number | string | null;
  productName: string;
  stock: number | string;
}

interface CheckoutResponse {
  success?: boolean;
  data?: { id: number; saleNumber: string };
  refund?: number;
}

/** The server's own settlement of this exchange (`POST /pos/exchange/quote`). */
interface ExchangeQuote {
  saleTotal: number;
  exchangeCredit: number;
  amountDue: number;
  refundDue: number;
}

type Tender = 'cash' | 'upi' | 'card';

interface ReturnLine {
  quantity: number;
  condition: Condition;
}

interface NewItem {
  barcode: string;
  productName: string;
  size: string;
  color: string;
  unitPrice: number;
  quantity: number;
}

@Component({
  selector: 'app-mobile-exchange-screen',
  standalone: true,
  imports: [CommonModule, FormsModule, ReasonPickerComponent],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen mp-screen--no-nav exchange-screen">
        <header class="mp-header">
          <button
            type="button"
            class="icon-btn"
            aria-label="Back"
            (click)="goBack()"
          >
            <span class="material-icons">arrow_back</span>
          </button>
          <div class="header-title-wrap">
            <div class="mp-header__title">Exchange</div>
            @if (sale()) {
              <div class="header-sub">Bill #{{ sale()?.saleNumber }}</div>
            }
          </div>
          <div class="header-spacer"></div>
        </header>

        @if (loading()) {
          <div class="mp-card empty-card">
            <span class="material-icons spin">autorenew</span>
            <span>Loading&hellip;</span>
          </div>
        } @else if (!sale()) {
          <div class="empty-state">
            <span class="material-icons empty-state__icon">error_outline</span>
            <div class="empty-state__title">Bill not found</div>
            <button
              type="button"
              class="mp-btn mp-btn--secondary"
              (click)="goBack()"
            >
              Back
            </button>
          </div>
        } @else {
          <div class="exchange-body">
            <!-- §0 one exchange per bill. Shown only when the bill has already
                 been exchanged; a first exchange sees none of this. -->
            @if (priorExchange(); as prior) {
              <section class="bill-section">
                @if (exchangeBlocked()) {
                  <div class="policy-block">
                    <div class="policy-block__head">
                      <span class="material-icons">block</span>
                      <span>Already exchanged</span>
                    </div>
                    <p class="policy-block__body">
                      Bill {{ sale()?.saleNumber }} was exchanged on
                      <strong>{{ prior.dateLabel }}</strong> ({{ prior.returnNumber }}).
                      Store policy is one exchange per bill.
                    </p>
                    <p class="policy-block__body">
                      A manager or owner can approve another one.
                    </p>
                  </div>

                  @if (!overrideOpen()) {
                    <button
                      type="button"
                      class="mp-btn mp-btn--secondary override-btn"
                      (click)="openOverride()"
                    >
                      Manager override
                    </button>
                  } @else {
                    <div class="override-form">
                      <p class="override-form__hint">
                        The approving manager or owner signs in here. Their name is
                        recorded against this bill.
                      </p>
                      <input
                        class="mp-input"
                        type="email"
                        autocomplete="off"
                        placeholder="Manager email"
                        [(ngModel)]="overrideEmail"
                      />
                      <input
                        class="mp-input"
                        type="password"
                        autocomplete="off"
                        placeholder="Password"
                        [(ngModel)]="overridePassword"
                      />
                      <button
                        type="button"
                        class="mp-btn mp-btn--primary"
                        [disabled]="overrideVerifying()"
                        (click)="submitOverride()"
                      >
                        {{ overrideVerifying() ? 'Checking…' : 'Approve second exchange' }}
                      </button>
                    </div>
                  }
                } @else {
                  <div class="policy-approved">
                    <span class="material-icons">verified_user</span>
                    <span>Second exchange approved by {{ overrideApprover() }}</span>
                  </div>
                }
              </section>
            }

            <!-- The bill's customer, carried across so the cashier can see who
                 they are serving. Absent on a walk-in bill. -->
            @if (sale()?.customer) {
              <section class="bill-section">
                <div class="section-title">Customer</div>
                <div class="customer-card">
                  <span class="material-icons">person</span>
                  <div class="customer-card__text">
                    <div class="customer-card__name">{{ customerName() || 'Customer' }}</div>
                    <div class="customer-card__meta">{{ customerContact() }}</div>
                  </div>
                  <span class="customer-card__tag">From bill</span>
                </div>
              </section>
            }

            <!-- Return items -->
            <section class="bill-section">
              <div class="section-title">Return Items</div>
              <div class="items-list">
                @for (item of sale()?.items ?? []; track item.id) {
                  <div class="item-card">
                    <div class="item-card__head">
                      <div class="item-card__name">{{ productNameOf(item) }}</div>
                      <div class="item-card__price">
                        {{ formatCurrency(effectivePrice(item)) }}
                      </div>
                    </div>
                    <div class="item-card__meta">
                      @if (variantOf(item); as v) {
                        <span>{{ v }}</span>
                        <span class="dot">·</span>
                      }
                      @if (item.variant?.sku) {
                        <span class="sku">SKU: {{ item.variant?.sku }}</span>
                      }
                    </div>
                    <div class="item-card__counts">
                      <span>Bought: {{ num(item.quantity) }}</span>
                      <span class="dot">·</span>
                      <span>Returned already: {{ num(item.returnedQuantity) }}</span>
                    </div>

                    @if (availableFor(item) > 0) {
                      <div class="item-card__controls">
                        <div class="stepper">
                          <button
                            type="button"
                            class="stepper__btn"
                            (click)="decrementReturn(item)"
                            [disabled]="returnQtyFor(item) <= 0"
                            aria-label="Decrease"
                          >
                            <span class="material-icons">remove</span>
                          </button>
                          <div class="stepper__value">{{ returnQtyFor(item) }}</div>
                          <button
                            type="button"
                            class="stepper__btn"
                            (click)="incrementReturn(item)"
                            [disabled]="returnQtyFor(item) >= availableFor(item)"
                            aria-label="Increase"
                          >
                            <span class="material-icons">add</span>
                          </button>
                        </div>
                        <div class="available-hint">
                          of {{ availableFor(item) }} available
                        </div>
                      </div>

                      @if (returnQtyFor(item) > 0) {
                        <div class="condition-toggle">
                          <button
                            type="button"
                            class="cond-btn"
                            [attr.data-selected]="conditionFor(item) === 'resellable'"
                            (click)="setCondition(item, 'resellable')"
                          >
                            <span class="material-icons">check_circle</span>
                            Resellable
                          </button>
                          <button
                            type="button"
                            class="cond-btn"
                            [attr.data-selected]="conditionFor(item) === 'damaged'"
                            (click)="setCondition(item, 'damaged')"
                          >
                            <span class="material-icons">report_problem</span>
                            Damaged
                          </button>
                        </div>
                      }
                    } @else {
                      <div class="fully-returned-chip">
                        <span class="mp-chip status-returned">Fully returned</span>
                      </div>
                    }
                  </div>
                }
              </div>
            </section>

            <!-- New items -->
            <section class="bill-section">
              <div class="section-title">New Items</div>

              @if (newItems().length === 0) {
                <div class="mp-card empty-new">
                  <span class="material-icons">inventory_2</span>
                  <span>Scan items to add</span>
                </div>
              } @else {
                <div class="items-list">
                  @for (ni of newItems(); track ni.barcode; let idx = $index) {
                    <div class="item-card">
                      <div class="item-card__head">
                        <div class="item-card__name">{{ ni.productName }}</div>
                        <button
                          type="button"
                          class="icon-btn icon-btn--danger"
                          (click)="removeNewItem(idx)"
                          aria-label="Remove"
                        >
                          <span class="material-icons">close</span>
                        </button>
                      </div>
                      <div class="item-card__meta">
                        @if (newVariantOf(ni); as v) {
                          <span>{{ v }}</span>
                          <span class="dot">·</span>
                        }
                        <span class="sku">{{ ni.barcode }}</span>
                      </div>
                      <div class="new-item-row">
                        <div class="stepper">
                          <button
                            type="button"
                            class="stepper__btn"
                            (click)="decrementNew(idx)"
                            [disabled]="ni.quantity <= 1"
                            aria-label="Decrease"
                          >
                            <span class="material-icons">remove</span>
                          </button>
                          <div class="stepper__value">{{ ni.quantity }}</div>
                          <button
                            type="button"
                            class="stepper__btn"
                            (click)="incrementNew(idx)"
                            aria-label="Increase"
                          >
                            <span class="material-icons">add</span>
                          </button>
                        </div>
                        <div class="unit-price">
                          {{ formatCurrency(ni.unitPrice) }} each
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }

              <button
                type="button"
                class="mp-btn mp-btn--secondary mp-btn--block scan-btn"
                [disabled]="scanning()"
                (click)="onScanNew()"
              >
                @if (scanning()) {
                  <span class="spinner" aria-hidden="true"></span>
                  <span>Scanning&hellip;</span>
                } @else {
                  <span class="material-icons">qr_code_scanner</span>
                  <span>Scan new item</span>
                }
              </button>
            </section>

            <!-- Reason -->
            <section class="bill-section">
              <div class="section-title">Reason</div>
              <app-reason-picker [value]="reason()" (valueChange)="reason.set($event)" />
            </section>

            <!-- Math: the server's figures, so the screen and the bill agree -->
            <section class="bill-section">
              <div class="mp-card math-card">
                <div class="math-row">
                  <span>Return credit</span>
                  <span>{{ quote() ? formatCurrency(quote()!.exchangeCredit) : formatCurrency(returnTotal()) }}</span>
                </div>
                <div class="math-row">
                  <span>New items</span>
                  <span>{{ quote() ? formatCurrency(quote()!.saleTotal) : formatCurrency(newTotal()) }}</span>
                </div>
                <div class="math-divider"></div>
                <div class="math-row math-row--grand" [attr.data-direction]="diffDirection()">
                  <span>{{ diffLabel() }}</span>
                  <span>
                    @if (quoting()) {
                      <span class="spinner spinner--inline" aria-label="Working out the difference"></span>
                    } @else {
                      {{ formatCurrency(diffAmount()) }}
                    }
                  </span>
                </div>
                @if (quoteError()) {
                  <p class="quote-error">{{ quoteError() }}</p>
                }
              </div>
            </section>

            @if (diffDirection() === 'pay') {
              <section class="bill-section">
                <div class="section-title">Customer pays by</div>
                <div class="tender-row" role="radiogroup" aria-label="Payment for the difference">
                  @for (t of tenders; track t.id) {
                    <button
                      type="button"
                      role="radio"
                      class="tender-chip"
                      [class.tender-chip--on]="tender() === t.id"
                      [attr.aria-checked]="tender() === t.id"
                      (click)="tender.set(t.id)"
                    >
                      {{ t.label }}
                    </button>
                  }
                </div>
              </section>
            }

            <div class="action-spacer"></div>
          </div>

          <div class="mp-action-bar exchange-action-bar">
            <button
              type="button"
              class="mp-btn mp-btn--primary mp-btn--block mp-btn--lg"
              [disabled]="!canSubmit() || submitting()"
              (click)="submit()"
            >
              @if (submitting()) {
                <span class="spinner" aria-hidden="true"></span>
                <span>Processing&hellip;</span>
              } @else {
                <span class="material-icons">swap_horiz</span>
                <span>Process Exchange</span>
              }
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }

      .exchange-screen {
        padding-bottom: calc(120px + var(--mp-safe-bottom));
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

      .icon-btn--danger {
        color: var(--mp-error);
      }

      .icon-btn:active { background: var(--mp-surface-2); }

      .header-title-wrap {
        flex: 1;
        min-width: 0;
        padding: 0 12px;
        text-align: center;
      }

      .header-sub {
        font-size: 12px;
        color: var(--mp-on-bg-muted);
        font-weight: 500;
        margin-top: 2px;
      }

      .header-spacer { width: 40px; }

      .exchange-body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .section-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--mp-on-bg-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0 4px 8px;
      }

      .items-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .item-card {
        background: var(--mp-surface);
        border: 1px solid var(--mp-border);
        border-radius: 16px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .item-card__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .item-card__name {
        font-size: 15px;
        font-weight: 700;
        color: var(--mp-on-bg);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .item-card__price {
        font-size: 14px;
        font-weight: 700;
        color: var(--mp-on-bg);
      }

      .item-card__meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--mp-on-bg-muted);
      }

      .item-card__counts {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--mp-on-bg-muted);
      }

      .item-card__meta .dot,
      .item-card__counts .dot { opacity: 0.6; }

      .sku { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }

      .item-card__controls {
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .new-item-row {
        margin-top: 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .unit-price {
        font-size: 13px;
        color: var(--mp-on-bg-muted);
        font-weight: 600;
      }

      .stepper {
        display: inline-flex;
        align-items: center;
        background: var(--mp-surface-2);
        border: 1px solid var(--mp-border);
        border-radius: 14px;
        overflow: hidden;
      }

      .stepper__btn {
        background: transparent;
        border: 0;
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--mp-on-bg);
        cursor: pointer;
      }

      .stepper__btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .stepper__btn .material-icons { font-size: 20px; }

      .stepper__value {
        min-width: 40px;
        text-align: center;
        font-weight: 700;
        font-size: 16px;
        color: var(--mp-on-bg);
      }

      .available-hint {
        font-size: 12px;
        color: var(--mp-on-bg-muted);
      }

      .condition-toggle {
        margin-top: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .cond-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 40px;
        padding: 0 10px;
        border-radius: 12px;
        background: var(--mp-surface-2);
        border: 1px solid var(--mp-border);
        color: var(--mp-on-bg-muted);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .cond-btn .material-icons { font-size: 16px; }

      .cond-btn[data-selected='true'] {
        background: var(--mp-primary-soft);
        border-color: var(--mp-primary);
        color: var(--mp-primary);
      }

      .fully-returned-chip { margin-top: 6px; }

      .status-returned {
        background: var(--mp-error-soft);
        color: var(--mp-error);
      }

      .empty-new {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 22px 16px;
        color: var(--mp-on-bg-muted);
        font-size: 14px;
        margin-bottom: 10px;
      }

      .empty-new .material-icons {
        font-size: 20px;
        color: var(--mp-on-bg-faint);
      }

      .scan-btn {
        margin-top: 10px;
        min-height: 52px;
      }

      /* §0 one exchange per bill */
      .policy-block {
        border-radius: 14px;
        padding: 14px 16px;
        background: var(--mp-error-soft);
        border: 1px solid var(--mp-error);
      }

      .policy-block__head {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
        font-weight: 700;
        color: var(--mp-on-bg);
      }

      .policy-block__head .material-icons {
        font-size: 20px;
        color: var(--mp-error);
      }

      .policy-block__body {
        margin: 8px 0 0;
        font-size: 13px;
        line-height: 1.45;
        color: var(--mp-on-bg-muted);
      }

      .override-btn {
        width: 100%;
        margin-top: 12px;
      }

      .override-form {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .override-form__hint {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--mp-on-bg-muted);
      }

      .policy-approved {
        display: flex;
        align-items: center;
        gap: 8px;
        border-radius: 14px;
        padding: 12px 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--mp-on-bg);
        background: var(--mp-surface-2);
      }

      .policy-approved .material-icons { font-size: 20px; }

      .customer-card {
        display: flex;
        align-items: center;
        gap: 12px;
        border-radius: 14px;
        padding: 12px 16px;
        background: var(--mp-surface-2);
      }

      .customer-card__text { flex: 1; min-width: 0; }

      .customer-card__name {
        font-size: 15px;
        font-weight: 600;
        color: var(--mp-on-bg);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .customer-card__meta {
        font-size: 12px;
        color: var(--mp-on-bg-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .customer-card__tag {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--mp-on-bg-muted);
        flex-shrink: 0;
      }


      .math-card {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .math-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-size: 14px;
        color: var(--mp-on-bg);
      }

      .math-divider {
        height: 1px;
        background: var(--mp-border);
        margin: 6px 0;
      }

      .math-row--grand {
        font-size: 17px;
        font-weight: 800;
      }

      .math-row--grand[data-direction='pay'] {
        color: var(--mp-warning);
      }

      .math-row--grand[data-direction='refund'] {
        color: var(--mp-success);
      }

      .math-row--grand[data-direction='even'] {
        color: var(--mp-on-bg);
      }

      .exchange-action-bar { bottom: 0; }

      .quote-error {
        margin: 4px 0 0;
        font-size: 13px;
        line-height: 1.4;
        color: var(--mp-error);
      }

      .tender-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .tender-chip {
        min-height: 48px;
        border-radius: 12px;
        border: 1px solid var(--mp-border);
        background: var(--mp-surface);
        color: var(--mp-on-bg);
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
      }

      .tender-chip--on {
        border-color: var(--mp-primary);
        background: var(--mp-primary-soft);
        color: var(--mp-primary);
      }

      .spinner--inline {
        display: inline-block;
        width: 16px;
        height: 16px;
        vertical-align: middle;
      }

      .action-spacer { height: 8px; }

      .empty-card {
        margin: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 28px 20px;
        color: var(--mp-on-bg-muted);
        font-size: 14px;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: 8px;
        padding: 64px 24px;
        color: var(--mp-on-bg-muted);
      }

      .empty-state__icon {
        font-size: 64px;
        color: var(--mp-on-bg-faint);
      }

      .empty-state__title {
        margin-top: 8px;
        font-size: 18px;
        font-weight: 700;
        color: var(--mp-on-bg);
      }

      .spinner {
        width: 18px;
        height: 18px;
        border: 2.5px solid rgba(255, 255, 255, 0.35);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: mp-spin 0.7s linear infinite;
      }

      .spin { animation: mp-spin 1s linear infinite; }

      @keyframes mp-spin {
        to { transform: rotate(360deg); }
      }
    `,
  ],
})
export class MobileExchangeScreen implements OnInit {
  private api = inject(ApiService);
  private notify = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private scanner = inject(MobileScannerService);

  readonly sale = signal<Sale | null>(null);
  readonly loading = signal<boolean>(true);
  readonly submitting = signal<boolean>(false);
  readonly scanning = signal<boolean>(false);

  readonly returnLines = signal<Record<number, ReturnLine>>({});
  readonly newItems = signal<NewItem[]>([]);
  readonly reason = signal<string>('');


  // ─── §0 one exchange per bill ──────────────────────────────
  // A bill that has already been exchanged is stopped here and let through
  // only on a manager's or owner's approval. A first exchange sees none of
  // this. The approval form is part of this full-screen route, not a modal.
  readonly priorExchange = computed(() => this.sale()?.priorExchange ?? null);
  readonly overrideOpen = signal<boolean>(false);
  readonly overrideVerifying = signal<boolean>(false);
  /** Signed, short-lived approval carried to submit. Never the password. */
  readonly overrideGrant = signal<string | null>(null);
  readonly overrideApprover = signal<string | null>(null);
  /** True while the policy still blocks this bill. */
  readonly exchangeBlocked = computed(
    () => !!this.priorExchange() && !this.overrideGrant()
  );

  overrideEmail = '';
  overridePassword = '';

  readonly returnTotal = computed(() => {
    const s = this.sale();
    if (!s) return 0;
    const map = this.returnLines();
    let total = 0;
    for (const it of s.items) {
      const line = map[it.id];
      if (!line || line.quantity <= 0) continue;
      total += this.effectivePrice(it) * line.quantity;
    }
    return total;
  });

  readonly newTotal = computed(() =>
    this.newItems().reduce((acc, ni) => acc + ni.unitPrice * ni.quantity, 0)
  );

  readonly totalReturnQty = computed(() => {
    const map = this.returnLines();
    return Object.values(map).reduce((acc, l) => acc + (l?.quantity ?? 0), 0);
  });

  readonly totalNewQty = computed(() =>
    this.newItems().reduce((acc, ni) => acc + ni.quantity, 0)
  );

  /**
   * The settlement as the server will bill it (offers, the credit at what the
   * customer actually paid, clearance rules). The local totals above are only
   * a placeholder while the quote is on its way.
   */
  readonly quote = signal<ExchangeQuote | null>(null);
  readonly quoting = signal(false);
  readonly quoteError = signal<string | null>(null);
  readonly tender = signal<Tender>('cash');
  readonly tenders: { id: Tender; label: string }[] = [
    { id: 'cash', label: 'Cash' },
    { id: 'upi', label: 'UPI' },
    { id: 'card', label: 'Card' },
  ];
  /** One key per exchange attempt, so a double tap cannot bill twice. */
  private clientRef = '';
  private readonly quote$ = new Subject<void>();

  readonly diffAmount = computed(() => {
    const q = this.quote();
    if (q) return q.amountDue > 0 ? q.amountDue : q.refundDue;
    return Math.abs(this.newTotal() - this.returnTotal());
  });

  readonly diffDirection = computed<'pay' | 'refund' | 'even'>(() => {
    const q = this.quote();
    const diff = q ? q.amountDue - q.refundDue : this.newTotal() - this.returnTotal();
    if (diff > 0) return 'pay';
    if (diff < 0) return 'refund';
    return 'even';
  });

  readonly diffLabel = computed(() => {
    const dir = this.diffDirection();
    if (dir === 'pay') return 'Customer pays';
    if (dir === 'refund') return 'Refund to customer';
    return 'Even exchange';
  });

  readonly canSubmit = computed(() => {
    // §0: a bill that has already been exchanged stays blocked until a
    // manager or owner approves. A first exchange is unaffected.
    if (this.exchangeBlocked()) return false;
    if (this.totalReturnQty() === 0 && this.totalNewQty() === 0) return false;
    if (this.reason().trim().length === 0) return false;
    // Only ever bill a figure the cashier has been shown.
    if (!this.quote() || this.quoting() || this.quoteError()) return false;
    return true;
  });

  private readonly destroyRef = inject(DestroyRef);
  private readonly offline = inject(OfflineService);

  constructor() {
    // Re-quote whenever what is going back or coming in changes.
    effect(
      () => {
        this.returnLines();
        this.newItems();
        this.overrideGrant();
        this.quote$.next();
      },
      { allowSignalWrites: true }
    );
    this.quote$
      .pipe(
        debounceTime(300),
        switchMap(() => {
          const body = this.exchangeBody();
          if (!body) {
            this.quote.set(null);
            this.quoting.set(false);
            return of(null);
          }
          this.quoting.set(true);
          return this.api.post<Envelope<ExchangeQuote>>('/pos/exchange/quote', body).pipe(
            catchError((err: unknown) => {
              const e = err as { error?: { error?: string } };
              this.quoteError.set(e?.error?.error || 'Could not work out the difference');
              this.quote.set(null);
              return of(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        this.quoting.set(false);
        if (res?.data) {
          this.quote.set(res.data);
          this.quoteError.set(null);
        }
      });
  }

  /** The checkout body for this exchange, without tenders; null until there is something to swap. */
  private exchangeBody(): Record<string, unknown> | null {
    const s = this.sale();
    if (!s) return null;
    const map = this.returnLines();
    const returnItems = s.items
      .filter((it) => (map[it.id]?.quantity ?? 0) > 0)
      .map((it) => ({ saleItemId: it.id, quantity: map[it.id].quantity, condition: map[it.id].condition }));
    const items = this.newItems().map((n) => ({ barcode: n.barcode, quantity: n.quantity }));
    if (returnItems.length === 0 || items.length === 0) return null;
    const exchange: Record<string, unknown> = { originalSaleId: s.id, returnItems };
    const grant = this.overrideGrant();
    if (grant) exchange['overrideGrant'] = grant;
    return { items, exchange };
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      this.notify.error('Missing sale ID');
      return;
    }
    this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.api.get<Envelope<Sale>>('/sales/' + encodeURIComponent(id)).subscribe({
      next: (res) => {
        const s = res?.data ?? null;
        this.sale.set(s);
        this.loading.set(false);
        if (s) {
          const init: Record<number, ReturnLine> = {};
          for (const it of s.items) {
            init[it.id] = { quantity: 0, condition: 'resellable' };
          }
          this.returnLines.set(init);
        }
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.sale.set(null);
        const e = err as { error?: { error?: string; message?: string }; message?: string };
        this.notify.error(
          e?.error?.error || e?.error?.message || e?.message || 'Failed to load bill'
        );
      },
    });
  }

  // ─── Navigation ──────────────────────────────────────────────
  goBack(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.router.navigate(['/mobile-pos/sales', id]);
    } else {
      this.router.navigate(['/mobile-pos/sales']);
    }
  }

  // ─── Return line controls ────────────────────────────────────
  incrementReturn(item: SaleItem): void {
    const current = this.returnQtyFor(item);
    const max = this.availableFor(item);
    if (current >= max) return;
    this.updateReturn(item.id, { quantity: current + 1 });
  }

  decrementReturn(item: SaleItem): void {
    const current = this.returnQtyFor(item);
    if (current <= 0) return;
    this.updateReturn(item.id, { quantity: current - 1 });
  }

  setCondition(item: SaleItem, cond: Condition): void {
    this.updateReturn(item.id, { condition: cond });
  }

  private updateReturn(id: number, patch: Partial<ReturnLine>): void {
    const prev = this.returnLines();
    const existing = prev[id] ?? { quantity: 0, condition: 'resellable' as Condition };
    this.returnLines.set({ ...prev, [id]: { ...existing, ...patch } });
  }

  // ─── New items ───────────────────────────────────────────────
  async onScanNew(): Promise<void> {
    if (this.scanning()) return;
    this.scanning.set(true);
    try {
      const { code, error } = await this.scanner.scan();
      if (error) {
        this.notify.error(error);
        return;
      }
      if (!code) return;
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

      // Merge into existing line if barcode already added
      const list = this.newItems();
      const idx = list.findIndex((n) => n.barcode === p.barcode);
      if (idx >= 0) {
        const updated = [...list];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        this.newItems.set(updated);
      } else {
        this.newItems.set([
          ...list,
          {
            barcode: p.barcode,
            productName: p.productName,
            size: p.size,
            color: p.color,
            unitPrice: Number(p.price),
            quantity: 1,
          },
        ]);
      }

      this.notify.success('Added: ' + p.productName);
    } catch (err: unknown) {
      const e = err as { error?: { error?: string; message?: string }; message?: string };
      this.notify.error(
        e?.error?.error ||
          e?.error?.message ||
          e?.message ||
          'Product not found for barcode ' + code
      );
    }
  }

  incrementNew(idx: number): void {
    const list = [...this.newItems()];
    if (!list[idx]) return;
    list[idx] = { ...list[idx], quantity: list[idx].quantity + 1 };
    this.newItems.set(list);
  }

  decrementNew(idx: number): void {
    const list = [...this.newItems()];
    if (!list[idx]) return;
    if (list[idx].quantity <= 1) return;
    list[idx] = { ...list[idx], quantity: list[idx].quantity - 1 };
    this.newItems.set(list);
  }

  removeNewItem(idx: number): void {
    const list = [...this.newItems()];
    list.splice(idx, 1);
    this.newItems.set(list);
  }

  // ─── Submit ──────────────────────────────────────────────────
  submit(): void {
    if (!this.canSubmit() || this.submitting()) return;
    const s = this.sale();
    if (!s) return;

    const base = this.exchangeBody();
    const q = this.quote();
    if (!base || !q) return;
    this.clientRef ||= this.offline.newClientRef();
    const body = {
      ...base,
      exchange: { ...(base['exchange'] as object), reasonCode: this.reason() },
      payments: q.amountDue > 0 ? [{ method: this.tender(), amount: q.amountDue }] : [],
      clientRef: this.clientRef,
    };

    this.submitting.set(true);
    this.api.post<CheckoutResponse>('/pos/checkout', body).subscribe({
      next: (res) => {
        this.submitting.set(false);
        const bill = res?.data;
        const refund = res?.refund ?? 0;
        this.notify.success(
          refund > 0
            ? `Exchange billed as ${bill?.saleNumber}. Refund ${this.formatCurrency(refund)} to the customer`
            : `Exchange billed as ${bill?.saleNumber}`
        );
        // The new bill is what the customer takes away: open it to print.
        this.router.navigate(['/mobile-pos/sales', bill?.id ?? s.id]);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const e = err as { error?: { error?: string; message?: string }; message?: string };
        this.notify.error(e?.error?.error || e?.error?.message || e?.message || 'Exchange failed');
      },
    });
  }

  // ─── §0 one exchange per bill: the manager override ────────

  /** Reveal the approval form. Deliberately a second, deliberate action. */
  openOverride(): void {
    this.overrideOpen.set(true);
  }

  /**
   * A manager or owner signs off with their own credentials, not the shared
   * Owner PIN, so the approval carries a name. The backend returns a grant
   * scoped to this one bill; that grant, never the password, travels on.
   */
  submitOverride(): void {
    const s = this.sale();
    if (!s || this.overrideVerifying()) return;
    const approverEmail = this.overrideEmail.trim();
    const approverPassword = this.overridePassword;
    if (!approverEmail || !approverPassword) {
      this.notify.error('Enter the manager or owner email and password');
      return;
    }

    this.overrideVerifying.set(true);
    this.api
      .post<Envelope<OverrideApproval>>('/sales/' + s.id + '/exchange-override', {
        approverEmail,
        approverPassword,
      })
      .subscribe({
        next: (res) => {
          this.overrideVerifying.set(false);
          this.overrideGrant.set(res?.data?.grant ?? null);
          this.overrideApprover.set(res?.data?.approverName ?? null);
          // The password has done its job. Nothing keeps it after this point.
          this.overridePassword = '';
          this.overrideEmail = '';
          this.overrideOpen.set(false);
          this.notify.success('Second exchange approved by ' + this.overrideApprover());
        },
        error: (err: unknown) => {
          this.overrideVerifying.set(false);
          this.overridePassword = '';
          const e = err as { error?: { error?: string; message?: string }; message?: string };
          this.notify.error(
            e?.error?.error || e?.error?.message || e?.message || 'Approval failed'
          );
        },
      });
  }

  /** The bill's customer, carried across from the original bill. */
  customerName(): string {
    const c = this.sale()?.customer;
    if (!c) return '';
    return `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  }

  customerContact(): string {
    const c = this.sale()?.customer;
    if (!c) return '';
    return c.phone || c.email || 'No contact on file';
  }

  // ─── Helpers ────────────────────────────────────────────────
  num(v: number | string | null | undefined): number {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  availableFor(item: SaleItem): number {
    return Math.max(0, this.num(item.quantity) - this.num(item.returnedQuantity));
  }

  returnQtyFor(item: SaleItem): number {
    return this.returnLines()[item.id]?.quantity ?? 0;
  }

  conditionFor(item: SaleItem): Condition {
    return this.returnLines()[item.id]?.condition ?? 'resellable';
  }

  effectivePrice(item: SaleItem): number {
    const eff = item.effectiveUnitPrice;
    if (eff !== null && eff !== undefined && eff !== '') {
      return this.num(eff);
    }
    return this.num(item.unitPrice);
  }

  productNameOf(item: SaleItem): string {
    return item.variant?.product?.name || item.variant?.sku || 'Unknown product';
  }

  variantOf(item: SaleItem): string | null {
    const parts: string[] = [];
    if (item.variant?.size) parts.push(String(item.variant.size));
    if (item.variant?.color) parts.push(String(item.variant.color));
    const s = parts.join(' · ');
    return s || null;
  }

  newVariantOf(ni: NewItem): string | null {
    const parts: string[] = [];
    if (ni.size) parts.push(ni.size);
    if (ni.color) parts.push(ni.color);
    const s = parts.join(' · ');
    return s || null;
  }

  formatCurrency(value: number): string {
    const v = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v);
  }
}
