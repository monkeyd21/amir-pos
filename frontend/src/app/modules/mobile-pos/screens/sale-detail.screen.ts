import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { environment } from '../../../../environments/environment';

interface SaleDetailItem {
  id?: number;
  variant?: {
    size?: string | null;
    color?: string | null;
    sku?: string | null;
    product?: {
      name?: string | null;
      brand?: { name?: string | null } | null;
    } | null;
  } | null;
  quantity: number | string;
  unitPrice: number | string;
  discount?: number | string | null;
  total: number | string;
  agent?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
}

interface SaleDetailPayment {
  method: string;
  amount: number | string;
}

interface SaleDetailCustomer {
  id?: number;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  loyaltyTier?: string | null;
}

interface SaleDetail {
  id: number;
  saleNumber: string;
  createdAt: string;
  status: string;
  subtotal: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  total: number | string;
  user?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  customer?: SaleDetailCustomer | null;
  branch?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
  } | null;
  items: SaleDetailItem[];
  payments: SaleDetailPayment[];
}

interface SaleDetailEnvelope {
  success?: boolean;
  data?: SaleDetail;
}

@Component({
  selector: 'app-mobile-sale-detail-screen',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen sale-detail-screen">
        <header class="mp-header">
          <button
            type="button"
            class="icon-btn"
            aria-label="Back to sales list"
            (click)="goBack()"
          >
            <span class="material-icons">arrow_back</span>
          </button>
          <div class="mp-header__title">
            @if (sale()) {
              Bill #{{ sale()?.saleNumber }}
            } @else {
              Bill
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
            <div class="empty-state__sub">
              This sale may have been removed.
            </div>
            <button
              type="button"
              class="mp-btn mp-btn--secondary"
              (click)="goBack()"
            >
              Back to sales
            </button>
          </div>
        } @else {
          <div class="detail-body">
            <!-- Bill info card -->
            <section class="bill-section">
              <div class="mp-card bill-info">
                <div class="bill-info__head">
                  <div class="bill-info__number">{{ sale()?.saleNumber }}</div>
                  <span
                    class="mp-chip status-chip"
                    [ngClass]="statusClass(sale()?.status)"
                  >
                    {{ formatStatus(sale()?.status) }}
                  </span>
                </div>
                <div class="bill-info__row">
                  <span class="bill-info__label">Date</span>
                  <span class="bill-info__value">
                    {{ formatDateTime(sale()?.createdAt) }}
                  </span>
                </div>
                <div class="bill-info__row">
                  <span class="bill-info__label">Cashier</span>
                  <span class="bill-info__value">{{ cashierName() }}</span>
                </div>
                @if (sale()?.branch?.name) {
                  <div class="bill-info__row">
                    <span class="bill-info__label">Branch</span>
                    <span class="bill-info__value">
                      {{ sale()?.branch?.name }}
                    </span>
                  </div>
                }
              </div>
            </section>

            <!-- Customer card -->
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
                    <div class="customer-card__meta">
                      @if (cust.phone) {
                        <span class="customer-card__phone">{{ cust.phone }}</span>
                      }
                      @if (cust.loyaltyTier) {
                        <span
                          class="mp-chip"
                          [ngClass]="tierClass(cust.loyaltyTier)"
                        >
                          {{ cust.loyaltyTier }}
                        </span>
                      }
                    </div>
                  </div>
                </div>
              } @else {
                <div class="mp-card walkin-card">
                  <span class="material-icons" aria-hidden="true">person_off</span>
                  <span>Walk-in customer</span>
                </div>
              }
            </section>

            <!-- Items list -->
            <section class="bill-section">
              <div class="section-title">Items</div>
              <div class="items-list">
                @for (item of sale()?.items ?? []; track $index) {
                  <div class="item-card">
                    <div class="item-card__row">
                      <div class="item-card__name">
                        {{ productNameOf(item) }}
                      </div>
                      <div class="item-card__total">
                        {{ formatCurrency(num(item.total)) }}
                      </div>
                    </div>
                    <div class="item-card__meta">
                      @if (variantOf(item); as v) {
                        <span class="item-card__variant">{{ v }}</span>
                        <span class="dot">·</span>
                      }
                      @if (item.variant?.sku) {
                        <span class="item-card__sku">
                          SKU: {{ item.variant?.sku }}
                        </span>
                      }
                    </div>
                    <div class="item-card__calc">
                      {{ num(item.quantity) }} × {{ formatCurrency(num(item.unitPrice)) }}
                      @if (num(item.discount) > 0) {
                        <span class="item-card__disc">
                          (−{{ formatCurrency(num(item.discount)) }})
                        </span>
                      }
                    </div>
                    @if (agentNameOf(item); as agent) {
                      <div class="agent-badge">
                        <span class="material-icons">person</span>
                        <span>by {{ agent }}</span>
                      </div>
                    }
                  </div>
                }
              </div>
            </section>

            <!-- Totals -->
            <section class="bill-section">
              <div class="mp-card totals">
                <div class="totals__row">
                  <span>Subtotal</span>
                  <span>{{ formatCurrency(num(sale()?.subtotal)) }}</span>
                </div>
                @if (num(sale()?.discountAmount) > 0) {
                  <div class="totals__row totals__row--savings">
                    <span>Discount</span>
                    <span>−{{ formatCurrency(num(sale()?.discountAmount)) }}</span>
                  </div>
                }
                @if (num(sale()?.taxAmount) > 0) {
                  <div class="totals__row">
                    <span>Tax</span>
                    <span>{{ formatCurrency(num(sale()?.taxAmount)) }}</span>
                  </div>
                }
                <div class="totals__divider"></div>
                <div class="totals__row totals__row--grand">
                  <span>Total</span>
                  <span>{{ formatCurrency(num(sale()?.total)) }}</span>
                </div>
              </div>
            </section>

            <!-- Payments -->
            @if ((sale()?.payments ?? []).length > 0) {
              <section class="bill-section">
                <div class="section-title">Payments</div>
                <div class="mp-card payments-card">
                  @for (p of sale()?.payments ?? []; track $index) {
                    <div class="payment-row">
                      <span class="payment-row__method">
                        {{ formatMethod(p.method) }}
                      </span>
                      <span class="payment-row__amount">
                        {{ formatCurrency(num(p.amount)) }}
                      </span>
                    </div>
                  }
                </div>
              </section>
            }

            <div class="action-spacer"></div>
          </div>

          <div class="mp-action-bar detail-action-bar">
            <div class="action-grid">
              @if (canReturnOrExchange()) {
                <div class="action-row-split">
                  <button
                    type="button"
                    class="mp-btn mp-btn--secondary split-btn"
                    (click)="goToReturn()"
                  >
                    <span class="material-icons">keyboard_return</span>
                    <span>Return</span>
                  </button>
                  <button
                    type="button"
                    class="mp-btn mp-btn--secondary split-btn"
                    (click)="goToExchange()"
                  >
                    <span class="material-icons">swap_horiz</span>
                    <span>Exchange</span>
                  </button>
                </div>
              }
              <button
                type="button"
                class="mp-btn mp-btn--primary mp-btn--lg share-btn"
                [disabled]="sharing()"
                (click)="shareBill()"
              >
                @if (sharing()) {
                  <span class="spinner" aria-hidden="true"></span>
                  <span>Sharing&hellip;</span>
                } @else {
                  <span class="material-icons">share</span>
                  <span>Send via WhatsApp</span>
                }
              </button>
              <button
                type="button"
                class="mp-btn mp-btn--secondary pdf-btn"
                [disabled]="openingPdf()"
                (click)="openPdf()"
              >
                @if (openingPdf()) {
                  <span class="spinner" aria-hidden="true"></span>
                } @else {
                  <span class="material-icons">picture_as_pdf</span>
                }
                <span>Open PDF</span>
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .sale-detail-screen {
        /* 72px bottom nav + ~140px action bar (with Return/Exchange buttons) + safe area */
        padding-bottom: calc(72px + 160px + var(--mp-safe-bottom));
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

      .icon-btn .material-icons {
        font-size: 24px;
      }

      .icon-btn:active {
        background: var(--mp-surface-2);
      }

      .header-spacer {
        width: 40px;
      }

      .detail-body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .bill-section {
        display: block;
      }

      .section-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--mp-on-bg-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0 4px 8px;
      }

      /* Bill info */
      .bill-info__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        gap: 10px;
      }

      .bill-info__number {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 20px;
        font-weight: 800;
        color: var(--mp-on-bg);
        letter-spacing: 0.02em;
      }

      .bill-info__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 0;
        font-size: 14px;
      }

      .bill-info__label {
        color: var(--mp-on-bg-muted);
      }

      .bill-info__value {
        color: var(--mp-on-bg);
        font-weight: 600;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 60%;
      }

      /* Status chip */
      .status-chip {
        padding: 4px 10px;
      }

      .status-chip.is-paid {
        background: var(--mp-success-soft);
        color: var(--mp-success);
      }

      .status-chip.is-returned {
        background: var(--mp-error-soft);
        color: var(--mp-error);
      }

      .status-chip.is-partial {
        background: rgba(251, 191, 36, 0.15);
        color: var(--mp-warning);
      }

      .status-chip.is-pending {
        background: var(--mp-surface-3);
        color: var(--mp-on-bg-muted);
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

      /* Items list */
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
        gap: 4px;
      }

      .item-card__row {
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

      .item-card__total {
        font-size: 15px;
        font-weight: 800;
        color: var(--mp-on-bg);
      }

      .item-card__meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--mp-on-bg-muted);
      }

      .item-card__meta .dot {
        opacity: 0.6;
      }

      .item-card__sku {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      }

      .item-card__calc {
        font-size: 13px;
        color: var(--mp-on-bg-muted);
        margin-top: 2px;
      }

      .item-card__disc {
        color: var(--mp-success);
        margin-left: 6px;
      }

      .agent-badge {
        margin-top: 6px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--mp-primary-soft);
        color: var(--mp-primary);
        font-size: 11px;
        font-weight: 700;
        align-self: flex-start;
      }

      .agent-badge .material-icons {
        font-size: 14px;
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
        font-size: 22px;
        font-weight: 800;
        color: var(--mp-primary);
        letter-spacing: -0.02em;
        padding-top: 6px;
      }

      /* Payments */
      .payments-card {
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .payment-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 14px;
      }

      .payment-row__method {
        color: var(--mp-on-bg);
        font-weight: 600;
        text-transform: capitalize;
      }

      .payment-row__amount {
        color: var(--mp-on-bg);
        font-weight: 700;
      }

      /* Action bar */
      .detail-action-bar {
        bottom: 72px;
      }

      .action-grid {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .share-btn {
        width: 100%;
      }

      .pdf-btn {
        width: 100%;
        min-height: 44px;
        font-size: 14px;
      }

      .action-row-split {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .split-btn {
        width: 100%;
        min-height: 48px;
        font-size: 14px;
      }

      .split-btn .material-icons {
        font-size: 18px;
      }

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

      .empty-state__sub {
        font-size: 13px;
        color: var(--mp-on-bg-muted);
        margin-bottom: 16px;
      }

      .action-spacer {
        height: 8px;
      }

      .spinner {
        width: 18px;
        height: 18px;
        border: 2.5px solid rgba(255, 255, 255, 0.35);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: mp-spin 0.7s linear infinite;
      }

      .spin {
        animation: mp-spin 1s linear infinite;
      }

      @keyframes mp-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class MobileSaleDetailScreen implements OnInit {
  private api = inject(ApiService);
  private notify = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // State
  readonly sale = signal<SaleDetail | null>(null);
  readonly loading = signal<boolean>(true);
  readonly sharing = signal<boolean>(false);
  readonly openingPdf = signal<boolean>(false);

  readonly cashierName = computed(() => {
    const u = this.sale()?.user;
    if (!u) return '—';
    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    return name || '—';
  });

  readonly canReturnOrExchange = computed(() => {
    const s = this.sale();
    if (!s) return false;
    const status = String(s.status || '').toLowerCase();
    // Hide when the sale has been fully returned
    return status !== 'returned';
  });

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (!idParam) {
      this.loading.set(false);
      this.notify.error('Missing sale ID');
      return;
    }
    this.load(idParam);
  }

  // ─── Data ──────────────────────────────────────────────────
  private load(id: string): void {
    this.loading.set(true);
    this.api.get<SaleDetailEnvelope>('/sales/' + encodeURIComponent(id)).subscribe({
      next: (res) => {
        this.sale.set(res?.data ?? null);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.sale.set(null);
        const e = err as {
          error?: { error?: string; message?: string };
          message?: string;
        };
        const msg =
          e?.error?.error ||
          e?.error?.message ||
          e?.message ||
          'Failed to load bill';
        this.notify.error(msg);
      },
    });
  }

  // ─── Actions ───────────────────────────────────────────────
  goBack(): void {
    this.router.navigate(['/mobile-pos/sales']);
  }

  goToReturn(): void {
    const s = this.sale();
    if (!s) return;
    this.router.navigate(['/mobile-pos/sales', s.id, 'return']);
  }

  goToExchange(): void {
    const s = this.sale();
    if (!s) return;
    this.router.navigate(['/mobile-pos/sales', s.id, 'exchange']);
  }

  async shareBill(): Promise<void> {
    if (!this.sale()) return;
    if (this.sharing()) return;
    this.sharing.set(true);
    try {
      const current = this.sale();
      if (!current) return;
      const saleId = current.id;
      const saleNumber = current.saleNumber;
      const token = localStorage.getItem('accessToken') || '';
      const branchId = localStorage.getItem('branchId') || '1';
      const apiUrl = environment.apiUrl;

      const resp = await fetch(`${apiUrl}/sales/${saleId}/receipt.pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Branch-Id': branchId,
        },
      });
      if (!resp.ok) throw new Error('Failed to fetch bill');
      const blob = await resp.blob();

      const base64 = await this.blobToBase64(blob);
      const fileName = `bill-${saleNumber}.pdf`;

      if (Capacitor.isNativePlatform()) {
        const written = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });
        await Share.share({
          title: `Bill ${saleNumber}`,
          text: `Your bill from ${current.branch?.name ?? 'our store'}`,
          url: written.uri,
          dialogTitle: 'Share bill',
        });
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      this.notify.error(e?.message || 'Share failed');
    } finally {
      this.sharing.set(false);
    }
  }

  async openPdf(): Promise<void> {
    if (!this.sale()) return;
    if (this.openingPdf()) return;
    this.openingPdf.set(true);
    try {
      const current = this.sale();
      if (!current) return;
      const saleId = current.id;
      const saleNumber = current.saleNumber;
      const token = localStorage.getItem('accessToken') || '';
      const branchId = localStorage.getItem('branchId') || '1';
      const apiUrl = environment.apiUrl;

      const resp = await fetch(`${apiUrl}/sales/${saleId}/receipt.pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Branch-Id': branchId,
        },
      });
      if (!resp.ok) throw new Error('Failed to fetch bill');
      const blob = await resp.blob();

      if (Capacitor.isNativePlatform()) {
        const base64 = await this.blobToBase64(blob);
        const fileName = `bill-${saleNumber}.pdf`;
        const written = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });
        // Use Share dialog so the OS can route to a PDF viewer
        await Share.share({
          title: `Bill ${saleNumber}`,
          url: written.uri,
          dialogTitle: 'Open PDF',
        });
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      this.notify.error(e?.message || 'Open failed');
    } finally {
      this.openingPdf.set(false);
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const b64 = result.split(',')[1];
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ─── View helpers ─────────────────────────────────────────
  num(v: number | string | null | undefined): number {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  productNameOf(item: SaleDetailItem): string {
    return (
      item.variant?.product?.name ||
      item.variant?.sku ||
      'Unknown product'
    );
  }

  variantOf(item: SaleDetailItem): string | null {
    const parts: string[] = [];
    if (item.variant?.size) parts.push(String(item.variant.size));
    if (item.variant?.color) parts.push(String(item.variant.color));
    const s = parts.join(' · ');
    return s || null;
  }

  agentNameOf(item: SaleDetailItem): string | null {
    const a = item.agent;
    if (!a) return null;
    const first = (a.firstName ?? '').trim();
    if (!first) return null;
    return first;
  }

  statusClass(status: string | undefined | null): string {
    const s = (status || '').toLowerCase();
    if (s === 'paid' || s === 'completed') return 'is-paid';
    if (s === 'returned') return 'is-returned';
    if (s === 'partially_returned') return 'is-partial';
    return 'is-pending';
  }

  formatStatus(status: string | undefined | null): string {
    if (!status) return '—';
    const s = String(status).toLowerCase();
    if (s === 'partially_returned') return 'Partially Returned';
    return s
      .split('_')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
      .join(' ');
  }

  formatMethod(method: string): string {
    if (!method) return '—';
    const m = method.toLowerCase();
    if (m === 'upi') return 'UPI';
    return m.charAt(0).toUpperCase() + m.slice(1);
  }

  initialsFor(first?: string | null, last?: string | null): string {
    const a = (first || '').trim().charAt(0).toUpperCase();
    const b = (last || '').trim().charAt(0).toUpperCase();
    return a + b || '?';
  }

  tierClass(tier: string | undefined | null): string {
    const t = (tier || '').toLowerCase();
    if (t === 'bronze') return 'mp-tier-bronze';
    if (t === 'silver') return 'mp-tier-silver';
    if (t === 'gold') return 'mp-tier-gold';
    if (t === 'platinum') return 'mp-tier-platinum';
    return 'mp-tier-bronze';
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

  formatDateTime(iso: string | undefined | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return (
      d.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }) +
      ', ' +
      d.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    );
  }
}
