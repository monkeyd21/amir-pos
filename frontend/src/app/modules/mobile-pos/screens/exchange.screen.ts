import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MobileScannerService } from '../services/mobile-scanner.service';

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

interface Sale {
  id: number;
  saleNumber: string;
  status: string;
  items: SaleItem[];
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
  productName: string;
  stock: number | string;
}

interface ExchangeResponse {
  success?: boolean;
  data?: unknown;
  message?: string;
}

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
  imports: [CommonModule, FormsModule],
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
              <textarea
                class="mp-input reason-input"
                rows="3"
                [(ngModel)]="reasonText"
                (ngModelChange)="reason.set($event)"
                placeholder="Why is this being exchanged?"
              ></textarea>
            </section>

            <!-- Math -->
            <section class="bill-section">
              <div class="mp-card math-card">
                <div class="math-row">
                  <span>Return value</span>
                  <span>{{ formatCurrency(returnTotal()) }}</span>
                </div>
                <div class="math-row">
                  <span>New items value</span>
                  <span>{{ formatCurrency(newTotal()) }}</span>
                </div>
                <div class="math-divider"></div>
                <div class="math-row math-row--grand" [attr.data-direction]="diffDirection()">
                  <span>{{ diffLabel() }}</span>
                  <span>{{ formatCurrency(diffAmount()) }}</span>
                </div>
              </div>
            </section>

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

      .reason-input {
        min-height: 80px;
        padding: 14px 16px;
        line-height: 1.4;
        font-size: 15px;
        resize: vertical;
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

  reasonText = '';

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

  readonly diffAmount = computed(() =>
    Math.abs(this.newTotal() - this.returnTotal())
  );

  readonly diffDirection = computed<'pay' | 'refund' | 'even'>(() => {
    const diff = this.newTotal() - this.returnTotal();
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
    if (this.totalReturnQty() === 0 && this.totalNewQty() === 0) return false;
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

    const map = this.returnLines();
    const returnItems = s.items
      .filter((it) => (map[it.id]?.quantity ?? 0) > 0)
      .map((it) => ({
        saleItemId: it.id,
        quantity: map[it.id].quantity,
        condition: map[it.id].condition,
      }));

    const newItemsPayload = this.newItems().map((n) => ({
      barcode: n.barcode,
      quantity: n.quantity,
    }));

    const body = {
      reason: this.reason().trim(),
      returnItems,
      newItems: newItemsPayload,
    };

    this.submitting.set(true);
    this.api
      .post<ExchangeResponse>('/sales/' + s.id + '/exchange', body)
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          const msg = res?.message || 'Exchange processed';
          this.notify.success(msg);
          this.router.navigate(['/mobile-pos/sales', s.id]);
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          const e = err as { error?: { error?: string; message?: string }; message?: string };
          this.notify.error(
            e?.error?.error || e?.error?.message || e?.message || 'Exchange failed'
          );
        },
      });
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
