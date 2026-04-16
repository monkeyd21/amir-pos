import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';

type SaleStatus =
  | 'paid'
  | 'returned'
  | 'partially_returned'
  | 'pending'
  | string;

interface SaleListItem {
  id: number;
  saleNumber: string;
  createdAt: string;
  total: number | string | null;
  totalAmount?: number | string | null;
  status: SaleStatus;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null;
  user?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  items?: Array<unknown>;
  _count?: { items?: number } | null;
}

interface SalesListMeta {
  page?: number;
  totalPages?: number;
  total?: number;
  limit?: number;
}

type FilterChip = 'today' | 'week' | 'month' | 'all';

interface SalesListEnvelope {
  success?: boolean;
  data?: SaleListItem[] | { sales?: SaleListItem[] };
  meta?: SalesListMeta;
}

@Component({
  selector: 'app-mobile-sales-list-screen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen sales-screen">
        <header class="mp-header">
          <div class="mp-header__title">Sales</div>
          @if (totalCount() > 0) {
            <div class="header-total" aria-label="Total of filtered sales">
              <div class="header-total__label">Total</div>
              <div class="header-total__value">
                {{ formatCurrency(grandTotal()) }}
              </div>
            </div>
          }
        </header>

        <div class="search-wrap">
          <span class="material-icons search-icon" aria-hidden="true">
            search
          </span>
          <input
            type="search"
            inputmode="search"
            class="mp-input search-input"
            placeholder="Search by bill #, phone or name"
            [ngModel]="searchText()"
            (ngModelChange)="onSearchInput($event)"
            (keydown.enter)="onSearchEnter()"
            autocomplete="off"
            spellcheck="false"
          />
          @if (searchText()) {
            <button
              type="button"
              class="search-clear"
              aria-label="Clear search"
              (click)="clearSearch()"
            >
              <span class="material-icons">close</span>
            </button>
          }
        </div>

        <div class="chips" role="tablist" aria-label="Date range">
          <button
            type="button"
            class="chip"
            [class.is-active]="activeChip() === 'today'"
            (click)="selectChip('today')"
          >
            Today
          </button>
          <button
            type="button"
            class="chip"
            [class.is-active]="activeChip() === 'week'"
            (click)="selectChip('week')"
          >
            This Week
          </button>
          <button
            type="button"
            class="chip"
            [class.is-active]="activeChip() === 'month'"
            (click)="selectChip('month')"
          >
            This Month
          </button>
          <button
            type="button"
            class="chip"
            [class.is-active]="activeChip() === 'all'"
            (click)="selectChip('all')"
          >
            All
          </button>
        </div>

        <div class="list-wrap">
          @if (loading() && sales().length === 0) {
            <div class="mp-card empty-card">
              <span class="material-icons spin">autorenew</span>
              <span>Loading&hellip;</span>
            </div>
          } @else if (!loading() && sales().length === 0) {
            <div class="empty-state">
              <span class="material-icons empty-state__icon">receipt_long</span>
              <div class="empty-state__title">No sales found</div>
              <div class="empty-state__sub">
                Try a different search or filter
              </div>
            </div>
          } @else {
            <div class="sales-list">
              @for (sale of sales(); track sale.id) {
                <button
                  type="button"
                  class="sale-card"
                  (click)="openSale(sale)"
                >
                  <div class="sale-card__row">
                    <div class="sale-card__bill">{{ sale.saleNumber }}</div>
                    <div class="sale-card__amount">
                      {{ formatCurrency(amountOf(sale)) }}
                    </div>
                  </div>
                  <div class="sale-card__row sale-card__row--sub">
                    <div class="sale-card__left">
                      <span class="sale-card__time">
                        {{ formatTime(sale.createdAt) }}
                      </span>
                      <span class="sale-card__dot">·</span>
                      <span
                        class="sale-card__customer"
                        [class.is-walkin]="!customerName(sale)"
                      >
                        {{ customerName(sale) || 'Walk-in' }}
                      </span>
                    </div>
                    <div class="sale-card__right">
                      <span class="sale-card__items">
                        {{ itemCount(sale) }}
                        {{ itemCount(sale) === 1 ? 'item' : 'items' }}
                      </span>
                    </div>
                  </div>
                  <div class="sale-card__row sale-card__row--foot">
                    <span
                      class="mp-chip status-chip"
                      [ngClass]="statusClass(sale.status)"
                    >
                      {{ formatStatus(sale.status) }}
                    </span>
                  </div>
                </button>
              }
            </div>

            @if (hasMore()) {
              <button
                type="button"
                class="mp-btn mp-btn--secondary mp-btn--block load-more"
                [disabled]="loading()"
                (click)="loadMore()"
              >
                @if (loading()) {
                  <span class="material-icons spin">autorenew</span>
                  <span>Loading&hellip;</span>
                } @else {
                  <span>Load more</span>
                  <span class="material-icons">expand_more</span>
                }
              </button>
            } @else if (sales().length > 0) {
              <div class="end-hint">
                Showing all {{ sales().length }} sales
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .sales-screen {
        padding-bottom: calc(72px + var(--mp-safe-bottom));
      }

      .header-total {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
      }

      .header-total__label {
        font-size: 10px;
        color: var(--mp-on-bg-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 700;
      }

      .header-total__value {
        font-size: 14px;
        font-weight: 700;
        color: var(--mp-on-bg);
        letter-spacing: -0.01em;
        line-height: 1.1;
      }

      /* Search */
      .search-wrap {
        position: relative;
        margin: 12px 16px 8px;
      }

      .search-input {
        padding-left: 48px;
        padding-right: 44px;
      }

      .search-icon {
        position: absolute;
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--mp-on-bg-faint);
        pointer-events: none;
        font-size: 22px;
      }

      .search-clear {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: transparent;
        border: 0;
        color: var(--mp-on-bg-muted);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .search-clear:active {
        background: var(--mp-surface-2);
      }

      .search-clear .material-icons {
        font-size: 20px;
      }

      /* Chips */
      .chips {
        display: flex;
        gap: 8px;
        padding: 8px 16px 4px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }

      .chips::-webkit-scrollbar {
        display: none;
      }

      .chip {
        flex-shrink: 0;
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid var(--mp-border);
        background: var(--mp-surface);
        color: var(--mp-on-bg-muted);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        min-height: 36px;
        transition: background 0.15s ease, color 0.15s ease,
          border-color 0.15s ease;
      }

      .chip.is-active {
        background: var(--mp-primary);
        color: var(--mp-primary-on);
        border-color: var(--mp-primary);
        box-shadow: 0 4px 14px -4px rgba(107, 138, 253, 0.45);
      }

      /* List */
      .list-wrap {
        padding: 12px 16px 24px;
      }

      .sales-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .sale-card {
        width: 100%;
        background: var(--mp-surface);
        border: 1px solid var(--mp-border);
        border-radius: 18px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: inherit;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        transition: transform 0.08s ease, background 0.15s ease;
      }

      .sale-card:active {
        transform: scale(0.99);
        background: var(--mp-surface-2);
      }

      .sale-card__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .sale-card__row--sub {
        font-size: 12px;
      }

      .sale-card__row--foot {
        margin-top: 2px;
      }

      .sale-card__bill {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 14px;
        font-weight: 700;
        color: var(--mp-on-bg);
        letter-spacing: 0.02em;
      }

      .sale-card__amount {
        font-size: 17px;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: var(--mp-on-bg);
      }

      .sale-card__left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1;
      }

      .sale-card__time {
        color: var(--mp-on-bg-muted);
        flex-shrink: 0;
      }

      .sale-card__dot {
        color: var(--mp-on-bg-faint);
      }

      .sale-card__customer {
        color: var(--mp-on-bg);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      .sale-card__customer.is-walkin {
        color: var(--mp-on-bg-faint);
        font-style: italic;
        font-weight: 500;
      }

      .sale-card__right {
        flex-shrink: 0;
      }

      .sale-card__items {
        color: var(--mp-on-bg-muted);
      }

      /* Status chips */
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

      /* Empty / loading */
      .empty-card {
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
        gap: 6px;
        padding: 64px 24px;
        color: var(--mp-on-bg-muted);
      }

      .empty-state__icon {
        font-size: 64px;
        color: var(--mp-on-bg-faint);
        opacity: 0.7;
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
      }

      .load-more {
        margin-top: 16px;
      }

      .end-hint {
        margin-top: 18px;
        text-align: center;
        font-size: 12px;
        color: var(--mp-on-bg-faint);
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
export class MobileSalesListScreen implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private notify = inject(NotificationService);

  // State
  readonly searchText = signal<string>('');
  readonly activeChip = signal<FilterChip>('all');
  readonly sales = signal<SaleListItem[]>([]);
  readonly loading = signal<boolean>(false);
  readonly page = signal<number>(1);
  readonly totalPages = signal<number>(1);
  readonly totalCount = signal<number>(0);
  readonly limit = 20;

  readonly hasMore = computed(() => this.page() < this.totalPages());
  readonly grandTotal = computed(() =>
    this.sales().reduce((sum, s) => sum + this.amountOf(s), 0),
  );

  private readonly searchSubject = new Subject<string>();
  private searchSub: Subscription | null = null;

  ngOnInit(): void {
    this.searchSub = this.searchSubject
      .pipe(debounceTime(300))
      .subscribe((value) => {
        this.searchText.set(value);
        this.resetAndLoad();
      });

    // Initial load
    this.resetAndLoad();
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  // ─── Event handlers ────────────────────────────────────────
  onSearchInput(value: string): void {
    this.searchSubject.next(value ?? '');
  }

  onSearchEnter(): void {
    this.resetAndLoad();
  }

  clearSearch(): void {
    this.searchText.set('');
    this.resetAndLoad();
  }

  selectChip(chip: FilterChip): void {
    if (this.activeChip() === chip) return;
    this.activeChip.set(chip);
    this.resetAndLoad();
  }

  loadMore(): void {
    if (this.loading() || !this.hasMore()) return;
    this.page.update((p) => p + 1);
    this.load(false);
  }

  openSale(sale: SaleListItem): void {
    this.router.navigate(['/mobile-pos/sales', sale.id]);
  }

  // ─── Data ──────────────────────────────────────────────────
  private resetAndLoad(): void {
    this.page.set(1);
    this.totalPages.set(1);
    this.sales.set([]);
    this.load(true);
  }

  private load(reset: boolean): void {
    if (this.loading()) return;
    this.loading.set(true);

    const params: Record<string, string | number | boolean> = {
      page: this.page(),
      limit: this.limit,
    };

    const q = this.searchText().trim();
    if (q) params['search'] = q;

    const range = this.chipRange(this.activeChip());
    if (range.startDate) params['startDate'] = range.startDate;
    if (range.endDate) params['endDate'] = range.endDate;

    this.api.get<SalesListEnvelope>('/sales', params).subscribe({
      next: (res) => {
        const raw = res?.data;
        let list: SaleListItem[] = [];
        if (Array.isArray(raw)) {
          list = raw;
        } else if (
          raw &&
          typeof raw === 'object' &&
          Array.isArray((raw as { sales?: SaleListItem[] }).sales)
        ) {
          list = (raw as { sales: SaleListItem[] }).sales;
        }

        const meta = res?.meta ?? {};
        const tp = Number(meta.totalPages ?? 1);
        const tot = Number(meta.total ?? list.length);

        if (reset) {
          this.sales.set(list);
        } else {
          this.sales.update((existing) => [...existing, ...list]);
        }

        this.totalPages.set(Number.isFinite(tp) && tp > 0 ? tp : 1);
        this.totalCount.set(Number.isFinite(tot) && tot > 0 ? tot : list.length);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        const e = err as {
          error?: { error?: string; message?: string };
          message?: string;
        };
        const msg =
          e?.error?.error ||
          e?.error?.message ||
          e?.message ||
          'Failed to load sales';
        this.notify.error(msg);
      },
    });
  }

  private chipRange(chip: FilterChip): {
    startDate?: string;
    endDate?: string;
  } {
    if (chip === 'all') return {};

    const now = new Date();
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );
    let start: Date;

    if (chip === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (chip === 'week') {
      // Start of this week (Monday)
      const day = now.getDay(); // 0=Sun ... 6=Sat
      const diff = (day + 6) % 7; // Mon=0
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
    } else {
      // month
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }

  // ─── View helpers ─────────────────────────────────────────
  customerName(sale: SaleListItem): string | null {
    const c = sale.customer;
    if (!c) return null;
    const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    return name || null;
  }

  itemCount(sale: SaleListItem): number {
    const explicit = sale._count?.items;
    if (typeof explicit === 'number') return explicit;
    if (Array.isArray(sale.items)) return sale.items.length;
    return 0;
  }

  amountOf(sale: SaleListItem): number {
    const v = sale.total ?? sale.totalAmount ?? 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  statusClass(status: SaleStatus): string {
    const s = (status || '').toLowerCase();
    if (s === 'paid' || s === 'completed') return 'is-paid';
    if (s === 'returned') return 'is-returned';
    if (s === 'partially_returned') return 'is-partial';
    return 'is-pending';
  }

  formatStatus(status: SaleStatus): string {
    if (!status) return '—';
    const s = String(status).toLowerCase();
    if (s === 'partially_returned') return 'Partially Returned';
    return s
      .split('_')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
      .join(' ');
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

  formatTime(iso: string): string {
    if (!iso) return '';
    const then = new Date(iso);
    if (isNaN(then.getTime())) return '';
    const now = new Date();
    const diffMs = now.getTime() - then.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const sameDay =
      then.getFullYear() === now.getFullYear() &&
      then.getMonth() === now.getMonth() &&
      then.getDate() === now.getDate();
    if (sameDay) {
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 6) return diffHr + 'h ago';
      return then.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
    }
    const diffDay = Math.floor(diffMin / (60 * 24));
    if (diffDay < 7) {
      return then.toLocaleDateString([], {
        weekday: 'short',
      }) +
        ' ' +
        then.toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        });
    }
    return then.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  }
}
