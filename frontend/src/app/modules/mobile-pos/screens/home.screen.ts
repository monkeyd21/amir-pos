import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MobileCartService } from '../services/mobile-cart.service';
import { MobileScannerService } from '../services/mobile-scanner.service';

interface PosSession {
  id: number;
  openingAmount: number;
  status: string;
}

interface DailySummary {
  totalSales?: number;
  salesCount?: number;
  [key: string]: unknown;
}

interface RecentSale {
  id: number;
  saleNumber: string;
  totalAmount: number;
  createdAt: string;
  customer?: { firstName?: string; lastName?: string } | null;
}

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

interface Envelope<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-mobile-home-screen',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen home-screen">
        <header class="mp-header">
          <div class="mp-header__title">Atelier POS</div>
          <div class="header-actions">
            <button
              type="button"
              class="icon-btn"
              (click)="refresh()"
              [disabled]="refreshing()"
              aria-label="Refresh"
            >
              <span class="material-icons" [class.spin]="refreshing()">refresh</span>
            </button>
            <button
              type="button"
              class="avatar"
              (click)="goProfile()"
              aria-label="Profile"
            >
              {{ initials() }}
            </button>
          </div>
        </header>

        <section class="greeting">
          <h1 class="greeting__title">
            {{ timeGreeting() }}, {{ firstName() }}
          </h1>
          <p class="greeting__sub">Ready to ring up some sales?</p>
        </section>

        @if (lastAdded()) {
          <div class="added-banner" role="status">
            <span class="material-icons">check_circle</span>
            <span>Added: {{ lastAdded() }}</span>
          </div>
        }

        @if (cartCount() > 0) {
          <div class="mp-card resume-card">
            <div class="resume-card__body">
              <div class="resume-card__title">
                You have {{ cartCount() }} {{ cartCount() === 1 ? 'item' : 'items' }} in your cart
              </div>
              <div class="resume-card__sub">{{ formatCurrency(cartTotal()) }} subtotal</div>
            </div>
            <button
              type="button"
              class="mp-btn mp-btn--primary"
              (click)="goCart()"
            >
              <span>Go to Cart</span>
              <span class="material-icons">chevron_right</span>
            </button>
          </div>
        }

        <section class="mp-card stats-card">
          <div class="stat">
            <div class="stat__label">Sales Today</div>
            <div class="stat__value">{{ salesCount() }}</div>
          </div>
          <div class="stat stat--divider">
            <div class="stat__label">Revenue</div>
            <div class="stat__value">{{ formatCurrency(revenue()) }}</div>
          </div>
        </section>

        <div class="cta-wrap">
          <button
            type="button"
            class="mp-btn mp-btn--primary mp-btn--block mp-btn--lg"
            (click)="onStartSale()"
            [disabled]="scanning()"
            [attr.aria-label]="cartCount() > 0 ? 'Continue sale' : 'Start sale'"
          >
            @if (scanning()) {
              <span class="cta-spinner" aria-hidden="true"></span>
              <span>Scanning&hellip;</span>
            } @else if (cartCount() > 0) {
              <span class="material-icons">shopping_cart</span>
              <span>Continue Sale &middot; {{ cartCount() }} {{ cartCount() === 1 ? 'item' : 'items' }}</span>
            } @else {
              <span class="material-icons">qr_code_scanner</span>
              <span>Start Sale</span>
            }
          </button>
          @if (cartCount() === 0) {
            <div class="cta-hint">Scan product barcode to begin</div>
          }
        </div>

        <section class="recent">
          <div class="recent__header">
            <h2 class="recent__title">Recent Sales</h2>
            @if (recentSales().length > 0) {
              <span class="recent__count">{{ recentSales().length }}</span>
            }
          </div>

          @if (loadingRecent()) {
            <div class="mp-card empty-card">
              <span class="material-icons spin">autorenew</span>
              <span>Loading&hellip;</span>
            </div>
          } @else if (recentSales().length === 0) {
            <div class="mp-card empty-card">
              <span class="material-icons">receipt_long</span>
              <span>No sales yet today</span>
            </div>
          } @else {
            <div class="recent__list">
              @for (sale of recentSales(); track sale.id) {
                <button
                  type="button"
                  class="mp-card sale-card"
                  (click)="onSaleTap(sale)"
                >
                  <div class="sale-card__left">
                    <div class="sale-card__number">{{ sale.saleNumber }}</div>
                    @if (customerName(sale); as name) {
                      <div class="sale-card__customer">{{ name }}</div>
                    } @else {
                      <div class="sale-card__customer muted">Walk-in</div>
                    }
                  </div>
                  <div class="sale-card__right">
                    <div class="sale-card__amount">
                      {{ formatCurrency(sale.totalAmount) }}
                    </div>
                    <div class="sale-card__time">{{ formatTime(sale.createdAt) }}</div>
                  </div>
                </button>
              }
            </div>
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .home-screen {
      padding-bottom: calc(96px + var(--mp-safe-bottom));
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .icon-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: transparent;
      border: 0;
      color: var(--mp-on-bg-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .icon-btn .material-icons { font-size: 22px; }

    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--mp-primary-soft);
      color: var(--mp-primary);
      border: 0;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.02em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .greeting {
      padding: 20px 20px 8px;
    }

    .greeting__title {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin: 0 0 4px 0;
      color: var(--mp-on-bg);
    }

    .greeting__sub {
      margin: 0;
      color: var(--mp-on-bg-muted);
      font-size: 15px;
    }

    .added-banner {
      margin: 8px 20px 0;
      padding: 12px 16px;
      border-radius: 14px;
      background: var(--mp-success-soft);
      color: var(--mp-success);
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 14px;
      animation: mp-pop-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .added-banner .material-icons {
      font-size: 20px;
    }

    .stats-card {
      margin: 16px 20px 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 20px 4px;
    }

    .stat {
      padding: 0 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-start;
    }

    .stat--divider {
      border-left: 1px solid var(--mp-border);
    }

    .stat__label {
      font-size: 12px;
      font-weight: 600;
      color: var(--mp-on-bg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .stat__value {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--mp-on-bg);
      line-height: 1.1;
    }

    .cta-wrap {
      margin: 24px 20px 28px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .cta-spinner {
      width: 20px;
      height: 20px;
      border: 2.5px solid rgba(255, 255, 255, 0.35);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: mp-spin 0.8s linear infinite;
      display: inline-block;
    }

    @keyframes mp-spin {
      to { transform: rotate(360deg); }
    }

    .cta-hint {
      font-size: 13px;
      color: var(--mp-on-bg-muted);
      font-weight: 500;
      letter-spacing: 0.01em;
    }

    .resume-card {
      margin: 12px 20px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
    }

    .resume-card__body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .resume-card__title {
      font-size: 14px;
      font-weight: 700;
      color: var(--mp-on-bg);
      letter-spacing: -0.01em;
    }

    .resume-card__sub {
      font-size: 12px;
      color: var(--mp-on-bg-muted);
    }

    .spin {
      animation: mp-spin 1s linear infinite;
    }

    .recent {
      padding: 8px 20px 0;
    }

    .recent__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding: 0 4px;
    }

    .recent__title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 0;
      color: var(--mp-on-bg);
    }

    .recent__count {
      font-size: 12px;
      font-weight: 700;
      color: var(--mp-on-bg-muted);
      background: var(--mp-surface-2);
      padding: 2px 10px;
      border-radius: 999px;
    }

    .recent__list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .empty-card {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 28px 20px;
      color: var(--mp-on-bg-muted);
      font-size: 14px;
    }

    .empty-card .material-icons {
      font-size: 22px;
    }

    .sale-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      background: var(--mp-surface);
      border: 1px solid var(--mp-border);
      border-radius: 18px;
      cursor: pointer;
      text-align: left;
      width: 100%;
      color: inherit;
      font-family: inherit;
      transition: transform 0.08s ease, background 0.15s ease;
    }

    .sale-card:active {
      transform: scale(0.985);
      background: var(--mp-surface-2);
    }

    .sale-card__left, .sale-card__right {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .sale-card__right { align-items: flex-end; }

    .sale-card__number {
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 13px;
      font-weight: 700;
      color: var(--mp-on-bg);
      letter-spacing: 0.02em;
    }

    .sale-card__customer {
      font-size: 13px;
      color: var(--mp-on-bg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 180px;
    }

    .sale-card__customer.muted {
      color: var(--mp-on-bg-faint);
      font-style: italic;
    }

    .sale-card__amount {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: var(--mp-on-bg);
    }

    .sale-card__time {
      font-size: 12px;
      color: var(--mp-on-bg-muted);
    }

    @keyframes mp-pop-in {
      0% { transform: scale(0.7); opacity: 0; }
      50% { transform: scale(1.05); }
      100% { transform: scale(1); opacity: 1; }
    }
  `],
})
export class MobileHomeScreen implements OnInit {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private notify = inject(NotificationService);
  private cart = inject(MobileCartService);
  private scanner = inject(MobileScannerService);
  private router = inject(Router);

  // Local reactive state
  readonly session = signal<PosSession | null>(null);
  readonly salesCount = signal<number>(0);
  readonly revenue = signal<number>(0);
  readonly recentSales = signal<RecentSale[]>([]);
  readonly loadingRecent = signal<boolean>(false);
  readonly scanning = signal<boolean>(false);
  readonly refreshing = signal<boolean>(false);
  readonly lastAdded = signal<string | null>(null);

  private lastAddedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly firstName = computed(() => this.auth.getCurrentUser()?.firstName ?? 'there');

  readonly cartCount = computed(() => this.cart.count());
  readonly cartTotal = computed(() => this.cart.total());

  readonly initials = computed(() => {
    const user = this.auth.getCurrentUser();
    if (!user) return '?';
    const f = (user.firstName ?? '').trim().charAt(0);
    const l = (user.lastName ?? '').trim().charAt(0);
    const combined = `${f}${l}`.toUpperCase();
    return combined || (user.email ?? '?').charAt(0).toUpperCase();
  });

  readonly timeGreeting = computed(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  });

  ngOnInit(): void {
    // Redirect to login if unauthenticated
    const currentUser = this.auth.getCurrentUser();
    if (!currentUser) {
      this.router.navigate(['/mobile-pos/login']);
      return;
    }

    // New cart items default to the cashier as their agent
    this.cart.defaultAgentId.set(currentUser.id);

    this.ensureSession();
    this.loadStats();
    this.loadRecent();
  }

  // ─── Data loading ──────────────────────────────────────────

  private ensureSession(): void {
    this.api.get<Envelope<PosSession | null>>('/pos/sessions/current').subscribe({
      next: (res) => {
        if (res?.data) {
          this.session.set(res.data);
        } else {
          this.openSession();
        }
      },
      error: () => {
        // If 4xx/5xx, still try to open
        this.openSession();
      },
    });
  }

  private openSession(): void {
    this.api
      .post<Envelope<PosSession>>('/pos/sessions/open', { openingAmount: 0 })
      .subscribe({
        next: (res) => {
          if (res?.data) this.session.set(res.data);
        },
        error: (err) => {
          const msg =
            err?.error?.error || err?.error?.message || 'Could not open POS session';
          this.notify.error(msg);
        },
      });
  }

  private loadStats(): void {
    this.api.get<Envelope<DailySummary>>('/reports/daily-summary').subscribe({
      next: (res) => {
        const d = res?.data ?? {};
        this.salesCount.set(Number(d.salesCount ?? 0));
        this.revenue.set(Number(d.totalSales ?? 0));
      },
      error: () => {
        this.salesCount.set(0);
        this.revenue.set(0);
      },
    });
  }

  private loadRecent(): void {
    this.loadingRecent.set(true);
    this.api
      .get<Envelope<RecentSale[] | { sales: RecentSale[] }>>('/sales', { limit: 5 })
      .subscribe({
        next: (res) => {
          const raw = res?.data as unknown;
          let list: RecentSale[] = [];
          if (Array.isArray(raw)) {
            list = raw as RecentSale[];
          } else if (raw && typeof raw === 'object' && Array.isArray((raw as { sales?: RecentSale[] }).sales)) {
            list = (raw as { sales: RecentSale[] }).sales;
          }
          this.recentSales.set(list.slice(0, 5));
          this.loadingRecent.set(false);
        },
        error: () => {
          this.recentSales.set([]);
          this.loadingRecent.set(false);
        },
      });
  }

  refresh(): void {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.loadStats();
    this.loadRecent();
    // Release the spinner after a short delay so the user sees feedback
    setTimeout(() => this.refreshing.set(false), 600);
  }

  // ─── Start sale / scan handler ─────────────────────────────

  async onStartSale(): Promise<void> {
    // If cart already has items, skip scanning and go straight to cart
    if (this.cart.count() > 0) {
      this.goCart();
      return;
    }

    if (this.scanning()) return;
    this.scanning.set(true);

    try {
      // Make sure a session is open before scanning
      if (!this.session()) {
        try {
          const res = await new Promise<Envelope<PosSession>>((resolve, reject) => {
            this.api
              .post<Envelope<PosSession>>('/pos/sessions/open', { openingAmount: 0 })
              .subscribe({ next: resolve, error: reject });
          });
          if (res?.data) this.session.set(res.data);
        } catch {
          // Non-fatal — backend may allow scan-without-session
        }
      }

      const { code, error } = await this.scanner.scan();
      if (error) {
        this.notify.error(error);
        return;
      }
      if (!code) {
        // User cancelled — do nothing
        return;
      }

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
        this.notify.warning(p.productName + ' is out of stock');
        return;
      }
      if (result === 'full') {
        this.notify.warning('Max stock reached');
        return;
      }

      // 'added' or 'incremented' — navigate to cart immediately after first scan
      this.showAddedBanner(p.productName);
      this.router.navigate(['/mobile-pos/cart']);
    } catch (err: unknown) {
      const e = err as { error?: { error?: string; message?: string } };
      const msg =
        e?.error?.error ||
        e?.error?.message ||
        'Product not found for barcode ' + code;
      this.notify.error(msg);
    }
  }

  private showAddedBanner(name: string): void {
    this.lastAdded.set(name);
    if (this.lastAddedTimer) {
      clearTimeout(this.lastAddedTimer);
    }
    this.lastAddedTimer = setTimeout(() => {
      this.lastAdded.set(null);
      this.lastAddedTimer = null;
    }, 3000);
  }

  // ─── UI helpers ────────────────────────────────────────────

  goProfile(): void {
    this.router.navigate(['/mobile-pos/profile']);
  }

  goCart(): void {
    this.router.navigate(['/mobile-pos/cart']);
  }

  onSaleTap(sale: RecentSale): void {
    this.router.navigate(['/mobile-pos/sales', sale.id]);
  }

  customerName(sale: RecentSale): string | null {
    const c = sale.customer;
    if (!c) return null;
    const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    return name || null;
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
    if (diffMin < 60) return diffMin + ' min ago';
    const sameDay =
      then.getFullYear() === now.getFullYear() &&
      then.getMonth() === now.getMonth() &&
      then.getDate() === now.getDate();
    if (sameDay) {
      return then.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
    }
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return diffDay + 'd ago';
    return then.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
