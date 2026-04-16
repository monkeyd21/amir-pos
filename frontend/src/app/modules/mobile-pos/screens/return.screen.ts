import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';

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
  id?: number;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

interface Sale {
  id: number;
  saleNumber: string;
  status: string;
  customer?: SaleCustomer | null;
  items: SaleItem[];
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
}

interface ReturnResponse {
  success?: boolean;
  data?: unknown;
  refundAmount?: number | string;
  message?: string;
}

interface LineState {
  quantity: number;
  condition: Condition;
}

@Component({
  selector: 'app-mobile-return-screen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen mp-screen--no-nav return-screen">
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
            <div class="mp-header__title">Return Items</div>
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
          <div class="return-body">
            <!-- Customer -->
            <section class="bill-section">
              @if (sale()?.customer; as cust) {
                <div class="mp-card customer-card">
                  <div class="customer-card__avatar">
                    {{ initialsFor(cust.firstName, cust.lastName) }}
                  </div>
                  <div class="customer-card__info">
                    <div class="customer-card__name">
                      {{ (cust.firstName || '') }} {{ (cust.lastName || '') }}
                    </div>
                    @if (cust.phone) {
                      <div class="customer-card__phone">{{ cust.phone }}</div>
                    }
                  </div>
                </div>
              } @else {
                <div class="mp-card walkin-card">
                  <span class="material-icons" aria-hidden="true">person_off</span>
                  <span>Walk-in customer</span>
                </div>
              }
            </section>

            <!-- Items -->
            <section class="bill-section">
              <div class="section-title">Items</div>
              <div class="items-list">
                @for (item of sale()?.items ?? []; track item.id) {
                  <div class="item-card">
                    <div class="item-card__head">
                      <div class="item-card__name">
                        {{ productNameOf(item) }}
                      </div>
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
                            (click)="decrement(item)"
                            [disabled]="qtyFor(item) <= 0"
                            aria-label="Decrease"
                          >
                            <span class="material-icons">remove</span>
                          </button>
                          <div class="stepper__value">{{ qtyFor(item) }}</div>
                          <button
                            type="button"
                            class="stepper__btn"
                            (click)="increment(item)"
                            [disabled]="qtyFor(item) >= availableFor(item)"
                            aria-label="Increase"
                          >
                            <span class="material-icons">add</span>
                          </button>
                        </div>
                        <div class="available-hint">
                          of {{ availableFor(item) }} available
                        </div>
                      </div>

                      @if (qtyFor(item) > 0) {
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

            <!-- Reason -->
            <section class="bill-section">
              <div class="section-title">Reason</div>
              <textarea
                class="mp-input reason-input"
                rows="3"
                [(ngModel)]="reasonText"
                (ngModelChange)="reason.set($event)"
                placeholder="Why is this being returned?"
              ></textarea>
            </section>

            <!-- Refund summary -->
            @if (selectedLines().length > 0) {
              <section class="bill-section">
                <div class="section-title">Refund Summary</div>
                <div class="mp-card refund-card">
                  @for (line of selectedLines(); track line.id) {
                    <div class="refund-row">
                      <span class="refund-row__name">
                        {{ line.name }} × {{ line.quantity }}
                      </span>
                      <span class="refund-row__amt">
                        {{ formatCurrency(line.subtotal) }}
                      </span>
                    </div>
                  }
                  <div class="refund-divider"></div>
                  <div class="refund-row refund-row--grand">
                    <span>Total refund</span>
                    <span>{{ formatCurrency(refundTotal()) }}</span>
                  </div>
                </div>
              </section>
            }

            <div class="action-spacer"></div>
          </div>

          <div class="mp-action-bar return-action-bar">
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
                <span class="material-icons">keyboard_return</span>
                <span>Process Return · {{ formatCurrency(refundTotal()) }}</span>
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

      .return-screen {
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

      .return-body {
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

      /* Customer */
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

      .customer-card__name {
        font-size: 15px;
        font-weight: 700;
        color: var(--mp-on-bg);
      }

      .customer-card__phone {
        font-size: 13px;
        color: var(--mp-on-bg-muted);
        margin-top: 2px;
      }

      .walkin-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px;
        color: var(--mp-on-bg-muted);
        font-size: 14px;
        font-style: italic;
      }

      .walkin-card .material-icons {
        font-size: 22px;
        color: var(--mp-on-bg-faint);
      }

      /* Items */
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

      /* Stepper */
      .item-card__controls {
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 14px;
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

      /* Condition toggle */
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

      .cond-btn .material-icons {
        font-size: 16px;
      }

      .cond-btn[data-selected='true'] {
        background: var(--mp-primary-soft);
        border-color: var(--mp-primary);
        color: var(--mp-primary);
      }

      .fully-returned-chip {
        margin-top: 6px;
      }

      .status-returned {
        background: var(--mp-error-soft);
        color: var(--mp-error);
      }

      /* Reason */
      .reason-input {
        min-height: 80px;
        padding: 14px 16px;
        line-height: 1.4;
        font-size: 15px;
        resize: vertical;
      }

      /* Refund card */
      .refund-card {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .refund-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-size: 14px;
        color: var(--mp-on-bg);
      }

      .refund-row__name {
        color: var(--mp-on-bg-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .refund-row__amt {
        font-weight: 600;
      }

      .refund-divider {
        height: 1px;
        background: var(--mp-border);
        margin: 6px 0;
      }

      .refund-row--grand {
        font-size: 18px;
        font-weight: 800;
        color: var(--mp-primary);
      }

      /* Action bar */
      .return-action-bar {
        bottom: 0;
      }

      .action-spacer { height: 8px; }

      /* Empty / loading */
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
export class MobileReturnScreen implements OnInit {
  private api = inject(ApiService);
  private notify = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly sale = signal<Sale | null>(null);
  readonly loading = signal<boolean>(true);
  readonly submitting = signal<boolean>(false);

  /** Per-item selection keyed by saleItemId */
  readonly lines = signal<Record<number, LineState>>({});
  readonly reason = signal<string>('');

  /** Two-way bound copy so ngModel stays in sync with the signal */
  reasonText = '';

  readonly selectedLines = computed(() => {
    const s = this.sale();
    if (!s) return [] as Array<{ id: number; name: string; quantity: number; subtotal: number }>;
    const map = this.lines();
    const out: Array<{ id: number; name: string; quantity: number; subtotal: number }> = [];
    for (const item of s.items) {
      const line = map[item.id];
      if (!line || line.quantity <= 0) continue;
      const price = this.effectivePrice(item);
      out.push({
        id: item.id,
        name: this.productNameOf(item),
        quantity: line.quantity,
        subtotal: price * line.quantity,
      });
    }
    return out;
  });

  readonly refundTotal = computed(() =>
    this.selectedLines().reduce((acc, l) => acc + l.subtotal, 0)
  );

  readonly canSubmit = computed(() => {
    if (this.selectedLines().length === 0) return false;
    if (this.reason().trim().length === 0) return false;
    return true;
  });

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
          // Initialize line state for every item
          const init: Record<number, LineState> = {};
          for (const it of s.items) {
            init[it.id] = { quantity: 0, condition: 'resellable' };
          }
          this.lines.set(init);
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

  // ─── Actions ─────────────────────────────────────────────────
  goBack(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.router.navigate(['/mobile-pos/sales', id]);
    } else {
      this.router.navigate(['/mobile-pos/sales']);
    }
  }

  increment(item: SaleItem): void {
    const current = this.qtyFor(item);
    const max = this.availableFor(item);
    if (current >= max) return;
    this.updateLine(item.id, { quantity: current + 1 });
  }

  decrement(item: SaleItem): void {
    const current = this.qtyFor(item);
    if (current <= 0) return;
    this.updateLine(item.id, { quantity: current - 1 });
  }

  setCondition(item: SaleItem, cond: Condition): void {
    this.updateLine(item.id, { condition: cond });
  }

  private updateLine(id: number, patch: Partial<LineState>): void {
    const prev = this.lines();
    const existing = prev[id] ?? { quantity: 0, condition: 'resellable' as Condition };
    this.lines.set({ ...prev, [id]: { ...existing, ...patch } });
  }

  submit(): void {
    if (!this.canSubmit() || this.submitting()) return;
    const s = this.sale();
    if (!s) return;

    const map = this.lines();
    const items = s.items
      .filter((it) => (map[it.id]?.quantity ?? 0) > 0)
      .map((it) => ({
        saleItemId: it.id,
        quantity: map[it.id].quantity,
        condition: map[it.id].condition,
      }));

    const body = {
      reason: this.reason().trim(),
      items,
    };

    this.submitting.set(true);
    this.api
      .post<ReturnResponse>('/sales/' + s.id + '/return', body)
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          const refund = Number(res?.refundAmount ?? this.refundTotal());
          this.notify.success(
            'Return processed — ' + this.formatCurrency(refund) + ' refund'
          );
          this.router.navigate(['/mobile-pos/sales', s.id]);
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          const e = err as { error?: { error?: string; message?: string }; message?: string };
          this.notify.error(
            e?.error?.error || e?.error?.message || e?.message || 'Return failed'
          );
        },
      });
  }

  // ─── View helpers ────────────────────────────────────────────
  num(v: number | string | null | undefined): number {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  availableFor(item: SaleItem): number {
    return Math.max(0, this.num(item.quantity) - this.num(item.returnedQuantity));
  }

  qtyFor(item: SaleItem): number {
    return this.lines()[item.id]?.quantity ?? 0;
  }

  conditionFor(item: SaleItem): Condition {
    return this.lines()[item.id]?.condition ?? 'resellable';
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

  initialsFor(first?: string | null, last?: string | null): string {
    const a = (first || '').trim().charAt(0).toUpperCase();
    const b = (last || '').trim().charAt(0).toUpperCase();
    return a + b || '?';
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
