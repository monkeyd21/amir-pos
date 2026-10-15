import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { OfflineService } from '../../../core/services/offline.service';
import { MobileScannerService } from '../services/mobile-scanner.service';

interface BasketLine {
  id: number;
  barcode: string;
  name: string;
  size: string;
  color: string;
  quantity: number;
  price: number;
}

interface Basket {
  id: number;
  code: string;
  lines: BasketLine[];
  pieces: number;
  value: number;
}

interface LocalLine {
  barcode: string;
  name: string | null;
  size: string | null;
  price: number | null;
  quantity: number;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

/**
 * The shop floor (dashboard spec §7.2 and §15.5).
 *
 * A salesperson scans what their customer is taking into a basket with a
 * three-digit code. Two ways out:
 *  - hand it to the cashier, who pulls the basket by its code: the bill then
 *    credits every piece to this salesperson;
 *  - nobody can bill it right now: record it as a PENDING SALE with the money
 *    taken. The stock comes off at once and the owner bills it later.
 *
 * With no network a basket cannot reach the till, but a pending sale can
 * still be captured against the cached catalog and syncs on reconnect.
 */
@Component({
  selector: 'app-mobile-floor-screen',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen floor-screen">
        <header class="mp-header">
          <div class="mp-header__title">Floor</div>
          @if (!online()) {
            <span class="offline-pill">Offline</span>
          }
        </header>

        @if (!online()) {
          <section class="floor-section">
            <div class="mp-card notice">
              You're offline, so a basket can't reach the till. Scan the pieces and record the sale as a
              <b>pending sale</b>; it syncs on its own when the connection is back.
              @if (queued() > 0) {
                <div class="notice__queued">{{ queued() }} waiting to sync</div>
              }
            </div>
          </section>
        }

        @if (online() && !basket()) {
          <section class="floor-section">
            <button type="button" class="mp-btn mp-btn--primary mp-btn--block mp-btn--lg" [disabled]="busy()" (click)="start()">
              <span class="material-icons">add_shopping_cart</span>
              Start a basket
            </button>
            @if (others().length) {
              <div class="section-title">Your open baskets</div>
              @for (b of others(); track b.id) {
                <button type="button" class="mp-card basket-row" (click)="resume(b)">
                  <span class="basket-row__code">{{ b.code }}</span>
                  <span class="basket-row__meta">{{ b.pieces }} piece{{ b.pieces === 1 ? '' : 's' }} · {{ money(b.value) }}</span>
                  <span class="material-icons">chevron_right</span>
                </button>
              }
            }
          </section>
        }

        @if (online() && basket(); as b) {
          <section class="floor-section">
            <div class="mp-card code-card">
              <div class="code-card__label">Basket</div>
              <div class="code-card__code" aria-live="polite">{{ b.code }}</div>
              <div class="code-card__hint">The cashier pulls it at the till with this number.</div>
            </div>
          </section>
        }

        @if (online() ? !!basket() : true) {
          <section class="floor-section">
            <button type="button" class="mp-btn mp-btn--secondary mp-btn--block mp-btn--lg" [disabled]="busy()" (click)="scan()">
              <span class="material-icons">qr_code_scanner</span>
              Scan a piece
            </button>
            <form class="manual" (ngSubmit)="addManual()">
              <input class="mp-input" name="code" placeholder="or type a barcode / SKU" [(ngModel)]="manualCode" autocomplete="off" />
              <button type="submit" class="mp-btn mp-btn--ghost" [disabled]="!manualCode.trim() || busy()">Add</button>
            </form>
          </section>

          <section class="floor-section">
            @if (lineCount() === 0) {
              <p class="empty">Nothing scanned yet.</p>
            }
            @for (l of viewLines(); track l.key) {
              <div class="mp-card line">
                <div class="line__main">
                  <div class="line__name">{{ l.name || l.barcode }}</div>
                  <div class="line__meta">
                    @if (l.size) { {{ sizeLabel(l.size) }} · }{{ l.price != null ? money(l.price) : 'price on sync' }}@if (l.quantity > 1) { · ×{{ l.quantity }} }
                  </div>
                </div>
                <button type="button" class="icon-btn" [attr.aria-label]="'Remove one ' + (l.name || l.barcode)" (click)="removeLine(l.key)">
                  <span class="material-icons">remove_circle_outline</span>
                </button>
              </div>
            }
            @if (lineCount() > 0) {
              <div class="total">
                <span>{{ pieces() }} piece{{ pieces() === 1 ? '' : 's' }}</span>
                <span>{{ money(value()) }}</span>
              </div>
            }
          </section>

          <div class="action-spacer"></div>
        }
      </div>

      @if ((online() && basket()) || (!online() && lineCount() > 0)) {
        <div class="mp-action-bar floor-actions">
          @if (online()) {
            <button type="button" class="mp-btn mp-btn--primary" [disabled]="busy() || lineCount() === 0" (click)="handOver()">
              To cashier
            </button>
          }
          <button type="button" class="mp-btn mp-btn--secondary" [disabled]="busy() || lineCount() === 0" (click)="openSheet()">
            Pending sale
          </button>
          @if (online()) {
            <button type="button" class="mp-btn mp-btn--ghost" [disabled]="busy()" (click)="abandon()" aria-label="Abandon this basket">
              <span class="material-icons">delete_outline</span>
            </button>
          }
        </div>
      }

      @if (sheetOpen()) {
        <div class="mp-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
        <div class="mp-sheet" role="dialog" aria-label="Record as pending sale">
          <div class="mp-sheet__handle"></div>
          <div class="mp-sheet__header"><b>Record as pending sale</b></div>
          <form class="mp-sheet__body sheet-body" (ngSubmit)="recordPending()">
            <p class="sheet-note">
              The pieces come off stock now so the website can't sell them again. The owner bills it later, dated today.
            </p>
            <div class="section-title">Money taken</div>
            <div class="tender-row" role="radiogroup">
              @for (m of modes; track m) {
                <button type="button" role="radio" class="tender-chip" [class.tender-chip--on]="pendingMode === m" [attr.aria-checked]="pendingMode === m" (click)="pendingMode = m">
                  {{ m === 'upi' ? 'UPI' : 'Cash' }}
                </button>
              }
            </div>
            <label class="field">
              <span>Amount received (₹)</span>
              <input class="mp-input" name="amt" type="number" inputmode="decimal" min="0" [(ngModel)]="pendingAmount" />
            </label>
            <label class="field">
              <span>Note (optional)</span>
              <input class="mp-input" name="note" maxlength="300" [(ngModel)]="pendingNote" placeholder="e.g. customer will come back for the bill" />
            </label>
            <button type="submit" class="mp-btn mp-btn--primary mp-btn--block mp-btn--lg" [disabled]="busy() || pendingAmount == null || pendingAmount < 0">
              {{ online() ? 'Save pending sale' : 'Save, sync later' }}
            </button>
          </form>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .floor-section { padding: 16px 16px 0; display: flex; flex-direction: column; gap: 10px; }
      .section-title { margin-top: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mp-on-bg-muted); }
      .offline-pill { padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: rgba(251, 191, 36, 0.15); color: var(--mp-warning); }
      .notice { font-size: 14px; line-height: 1.5; color: var(--mp-on-bg-muted); }
      .notice b { color: var(--mp-on-bg); }
      .notice__queued { margin-top: 8px; font-weight: 700; color: var(--mp-warning); }
      .basket-row { display: flex; align-items: center; gap: 14px; padding: 14px 16px; text-align: left; color: var(--mp-on-bg); font: inherit; cursor: pointer; }
      .basket-row__code { font-size: 22px; font-weight: 800; letter-spacing: 0.08em; }
      .basket-row__meta { flex: 1; color: var(--mp-on-bg-muted); font-size: 14px; }
      .code-card { text-align: center; padding: 18px; }
      .code-card__label { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mp-on-bg-muted); }
      .code-card__code { margin-top: 4px; font-size: 48px; font-weight: 800; letter-spacing: 0.14em; color: var(--mp-primary); font-variant-numeric: tabular-nums; }
      .code-card__hint { margin-top: 2px; font-size: 13px; color: var(--mp-on-bg-muted); }
      .manual { display: flex; gap: 8px; }
      .manual .mp-input { flex: 1; min-width: 0; }
      .empty { margin: 8px 0; font-size: 14px; color: var(--mp-on-bg-muted); text-align: center; }
      .line { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; }
      .line__main { flex: 1; min-width: 0; }
      .line__name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .line__meta { font-size: 13px; color: var(--mp-on-bg-muted); }
      .icon-btn { border: 0; background: transparent; color: var(--mp-on-bg-muted); padding: 6px; border-radius: 10px; }
      .total { display: flex; justify-content: space-between; padding: 6px 4px; font-weight: 700; }
      .action-spacer { height: 96px; }
      .floor-actions { display: flex; gap: 8px; }
      .floor-actions .mp-btn { flex: 1; white-space: nowrap; }
      .floor-actions .mp-btn--ghost { flex: 0 0 auto; }
      .sheet-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
      .sheet-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--mp-on-bg-muted); }
      .tender-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .tender-chip { min-height: 48px; border-radius: 12px; border: 1px solid var(--mp-border); background: var(--mp-surface-2); color: var(--mp-on-bg); font: inherit; font-weight: 700; }
      .tender-chip--on { border-color: var(--mp-primary); background: var(--mp-primary-soft); color: var(--mp-primary); }
      .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--mp-on-bg-muted); }
    `,
  ],
})
export class MobileFloorScreen implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotificationService);
  private readonly offline = inject(OfflineService);
  private readonly scanner = inject(MobileScannerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly online = signal(this.offline.isOnline);
  readonly queued = signal(this.offline.loadPendingSales().length);
  readonly basket = signal<Basket | null>(null);
  readonly others = signal<(Basket & { pieces: number; value: number })[]>([]);
  readonly local = signal<LocalLine[]>([]);
  readonly busy = signal(false);
  readonly sheetOpen = signal(false);
  readonly modes: ('cash' | 'upi')[] = ['cash', 'upi'];
  manualCode = '';
  pendingMode: 'cash' | 'upi' = 'cash';
  pendingAmount: number | null = null;
  pendingNote = '';

  readonly viewLines = computed(() =>
    this.online()
      ? (this.basket()?.lines ?? []).map((l) => ({ key: String(l.id), barcode: l.barcode, name: l.name, size: l.size, price: l.price, quantity: l.quantity }))
      : this.local().map((l) => ({ key: l.barcode, ...l }))
  );
  readonly lineCount = computed(() => this.viewLines().length);
  readonly pieces = computed(() => this.viewLines().reduce((t, l) => t + l.quantity, 0));
  readonly value = computed(() => this.viewLines().reduce((t, l) => t + (l.price ?? 0) * l.quantity, 0));

  ngOnInit(): void {
    this.offline.online$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((on) => {
      this.online.set(on);
      if (on) this.loadMine();
    });
    this.offline.pendingSales$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((n) => this.queued.set(n));
  }

  /** "Free" is free size, not free of charge: say so next to a price. */
  sizeLabel(size: string): string {
    return /^free$/i.test(size.trim()) ? 'Free size' : size;
  }

  money(n: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  }

  private loadMine(): void {
    this.api.get<Envelope<Basket[]>>('/floor-baskets', { mine: '1' }).subscribe({
      next: (res) => {
        const mine = res.data ?? [];
        if (!this.basket() && mine.length === 1) this.basket.set(mine[0]);
        else this.others.set(mine.filter((b) => b.id !== this.basket()?.id));
      },
      error: () => this.others.set([]),
    });
  }

  start(): void {
    this.busy.set(true);
    this.api.post<Envelope<Basket>>('/floor-baskets', {}).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.basket.set(res.data);
      },
      error: (err) => this.fail(err, 'Could not start a basket'),
    });
  }

  resume(b: Basket): void {
    this.basket.set(b);
    this.others.update((l) => l.filter((x) => x.id !== b.id));
  }

  async scan(): Promise<void> {
    const r = await this.scanner.scan();
    if (r.error) this.notify.error(r.error);
    if (r.code) this.add(r.code);
  }

  addManual(): void {
    const code = this.manualCode.trim();
    if (!code) return;
    this.manualCode = '';
    this.add(code);
  }

  private add(code: string): void {
    if (!this.online()) {
      // Priced from the cached catalog when we have it; the server prices it on sync anyway.
      const hit = this.offline.lookupBarcode(code);
      const barcode = hit?.barcode ?? code;
      this.local.update((lines) => {
        const i = lines.findIndex((l) => l.barcode === barcode);
        if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
        return [...lines, { barcode, name: hit?.productName ?? null, size: hit?.size ?? null, price: hit?.price ?? null, quantity: 1 }];
      });
      if (!hit) this.notify.error(`${code} isn't in the saved catalog; it will be checked on sync`);
      return;
    }
    const b = this.basket();
    if (!b) return;
    this.busy.set(true);
    this.api.post<Envelope<Basket>>(`/floor-baskets/${b.id}/items`, { barcode: code }).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.basket.set(res.data);
      },
      error: (err) => this.fail(err, `Not found: ${code}`),
    });
  }

  removeLine(key: string): void {
    if (!this.online()) {
      this.local.update((lines) =>
        lines.flatMap((l) => (l.barcode !== key ? [l] : l.quantity > 1 ? [{ ...l, quantity: l.quantity - 1 }] : []))
      );
      return;
    }
    const b = this.basket();
    if (!b) return;
    this.api.delete<Envelope<Basket>>(`/floor-baskets/${b.id}/items/${key}`).subscribe({
      next: (res) => this.basket.set(res.data),
      error: (err) => this.fail(err, 'Could not remove it'),
    });
  }

  handOver(): void {
    const b = this.basket();
    if (!b) return;
    this.notify.success(`Tell the cashier: basket ${b.code}`);
    this.basket.set(null);
    this.loadMine();
  }

  abandon(): void {
    const b = this.basket();
    if (!b) return;
    this.busy.set(true);
    this.api.post(`/floor-baskets/${b.id}/abandon`, {}).subscribe({
      next: () => {
        this.busy.set(false);
        this.basket.set(null);
        this.loadMine();
      },
      error: (err) => this.fail(err, 'Could not abandon it'),
    });
  }

  openSheet(): void {
    // Pre-filled with the pieces' value; the salesperson corrects it to what was actually taken.
    this.pendingAmount = Math.round(this.value());
    this.sheetOpen.set(true);
  }

  async recordPending(): Promise<void> {
    if (this.pendingAmount == null || this.pendingAmount < 0) return;
    const items = this.viewLines().map((l) => ({ barcode: l.barcode, quantity: l.quantity }));
    if (!items.length) return;
    const payload = {
      items,
      paymentMode: this.pendingMode,
      amountReceived: Number(this.pendingAmount),
      notes: this.pendingNote.trim() || null,
    };
    const clientRef = this.offline.newClientRef();

    if (!this.online()) {
      this.offline.queuePendingSale({ clientRef, createdAt: new Date().toISOString(), payload });
      this.done('Saved. It syncs when the connection is back.');
      this.local.set([]);
      return;
    }

    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.api.post<Envelope<{ number: string }>>('/pending-sales', {
          ...payload,
          clientRef,
          floorBasketId: this.basket()?.id ?? null,
        })
      );
      this.done(`Pending sale ${res.data.number} saved`);
      this.basket.set(null);
      this.loadMine();
    } catch (err: any) {
      // The network dropped mid-save: keep it, and the same key makes the retry safe.
      if (!err?.status) {
        this.offline.queuePendingSale({ clientRef, createdAt: new Date().toISOString(), payload });
        this.done('Saved offline. It syncs when the connection is back.');
        this.basket.set(null);
        return;
      }
      this.fail(err, 'Could not save the pending sale');
    }
  }

  private done(message: string): void {
    this.busy.set(false);
    this.sheetOpen.set(false);
    this.pendingAmount = null;
    this.pendingNote = '';
    this.notify.success(message);
  }

  private fail(err: any, fallback: string): void {
    this.busy.set(false);
    this.notify.error(err?.error?.error || fallback);
  }
}
