import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil, switchMap, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService, User } from '../../core/services/auth.service';
import { ReceiptPrintService } from '../../shared/receipt-print.service';

/**
 * A single payment entry the cashier has added to a sale. One sale can have
 * several tenders — e.g. ₹2999 cash + ₹3000 UPI for a ₹5999 total.
 *
 * For cash, `cashReceived` captures what the customer actually handed over so
 * we can display change due. The `amount` is clamped to the remaining balance
 * so change never inflates the bill.
 */
interface Tender {
  method: 'cash' | 'card' | 'upi';
  amount: number;
  cashReceived?: number;
}

interface ProductVariant {
  // flat fields from POS search endpoint
  variantId?: number;
  id?: number;
  sku: string;
  size?: string;
  color?: string;
  price: number;
  stock?: number;
  productName?: string;
  brand?: string;
  category?: string;
  barcode?: string;
  // nested fields (from other endpoints)
  product?: {
    id: number;
    name: string;
    brand?: { name: string };
  };
  inventory?: { currentStock: number }[];
}

interface CartOffer {
  id: number;
  name: string;
  type: string;
  displayText: string;
}

interface CartItem {
  variantId: number;
  /** Scanned barcode — shown as the "Code" column and used on checkout. */
  barcode: string;
  /** Internal SKU — the unique identifier column shown on the receipt. */
  sku: string;
  productName: string;
  brandName: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
  maxStock: number;
  // Offer state (refreshed via /pos/cart/evaluate)
  offer?: CartOffer | null;
  qualified?: boolean;
  offerDiscount?: number;
  effectiveUnitPrice?: number;
  offerHint?: string;
}

interface EvaluatedLine {
  variantId: number;
  quantity: number;
  unitPrice: number;
  offer: CartOffer | null;
  qualified: boolean;
  discountAmount: number;
  effectiveUnitPrice: number;
  lineTotal: number;
  hint?: string;
}

interface PosSession {
  id: number;
  openedAt: string;
  status: string;
  openingBalance: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
}

@Component({
  selector: 'app-pos-terminal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pos-terminal.component.html',
})
export class PosTerminalComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();
  private cartEvalSubject = new Subject<void>();

  currentUser: User | null = null;
  session: PosSession | null = null;
  sessionLoading = true;

  searchQuery = '';
  searchResults: ProductVariant[] = [];
  searchLoading = false;
  showSearchResults = false;
  /**
   * Index of the keyboard-highlighted row in `searchResults`. -1 means no
   * explicit keyboard selection yet — Enter in that state falls back to
   * "add the exact barcode match, else the first result" for scanner flows.
   */
  highlightedResultIndex = -1;

  cart: CartItem[] = [];

  // ─── Manual discount ─────────────────────────────────────────────
  //
  // The cashier can enter a manual discount as either a flat rupee amount
  // or a percentage of the taxable base (subtotal − offer discounts). The
  // raw input lives in `discountValue`; `resolvedDiscount` (getter) turns
  // it into ₹ at calculation time.
  //
  // `roundOff` is a separate "waive the single-digit remainder so the
  // customer pays a round ₹10 multiple" adjustment (Indian retail "chhota
  // chhod do" convention). It stacks on top of the manual discount.
  //
  // Everything is sent to the backend as a single `discountAmount` =
  // resolvedDiscount + roundOff. The backend doesn't need to know about
  // the mode toggle or rounding — it just sees one number.
  discountMode: 'amount' | 'percent' = 'amount';
  discountValue: number | null = null;
  // Stored as a *mode* not an amount, so if the cart or discount changes
  // after the cashier clicked "Round ↓", the rounding re-derives itself
  // against the new payable (otherwise a stale ₹7 waiver would hang around
  // after an item is removed and quietly throw the total off).
  roundMode: 'none' | 'down' | 'up' = 'none';
  taxRate = 0.18;

  // ─── Split-tender payment state ───────────────────────────────────
  //
  // `tenders` is the confirmed list that will be sent to the backend as the
  // `payments` array on checkout. `pending*` fields drive the "Add Payment"
  // panel in the UI — they're cleared after each add.
  tenders: Tender[] = [];
  pendingMethod: 'cash' | 'card' | 'upi' = 'cash';
  pendingAmount: number | null = null;

  checkoutLoading = false;
  customerId: number | null = null;
  customerName = '';

  // Customer search
  customerSearchQuery = '';
  customerSearchResults: any[] = [];
  customerSearchLoading = false;
  showCustomerResults = false;
  private customerSearchSubject = new Subject<string>();
  selectedCustomer: any = null;

  constructor(
    private api: ApiService,
    private notify: NotificationService,
    private auth: AuthService,
    private receiptPrint: ReceiptPrintService
  ) {}

  ngOnInit(): void {
    this.currentUser = this.auth.getCurrentUser();
    this.initSession();
    this.setupSearch();
    this.setupCustomerSearch();
    this.setupCartEvaluation();
  }

  ngAfterViewInit(): void {
    // Park the caret in the search box the moment the terminal loads so
    // the cashier can start scanning/typing without reaching for the mouse.
    this.focusSearchInput();
  }

  /**
   * Return focus to the search input. Used after every add-to-cart so
   * the next scan or keystroke lands in the right place — this is the
   * cornerstone of the "never touch the mouse" cashier workflow.
   */
  private focusSearchInput(): void {
    // Wrap in setTimeout so Angular's current change-detection cycle
    // finishes before we try to focus (the input may have been briefly
    // disabled or re-rendered).
    setTimeout(() => this.searchInputRef?.nativeElement?.focus(), 0);
  }

  private setupCartEvaluation(): void {
    // Debounce cart changes — when the user rapidly +/-s qty, only call once.
    this.cartEvalSubject
      .pipe(debounceTime(200), takeUntil(this.destroy$))
      .subscribe(() => this.evaluateCart());
  }

  /** Ask the backend which offers apply, and update cart items in place. */
  private evaluateCart(): void {
    if (this.cart.length === 0) return;
    const items = this.cart.map((c) => ({
      variantId: c.variantId,
      quantity: c.quantity,
    }));
    this.api
      .post<ApiResponse<EvaluatedLine[]>>('/pos/cart/evaluate', { items })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          for (const line of res.data ?? []) {
            const item = this.cart.find((c) => c.variantId === line.variantId);
            if (!item) continue;
            item.offer = line.offer;
            item.qualified = line.qualified;
            item.offerDiscount = line.discountAmount;
            item.effectiveUnitPrice = line.effectiveUnitPrice;
            item.offerHint = line.hint;
          }
        },
        error: () => {
          // Silent — don't spam the user. The cart still works without offer info.
        },
      });
  }

  private refreshCartOffers(): void {
    this.cartEvalSubject.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initSession(): void {
    this.sessionLoading = true;
    this.api
      .get<ApiResponse<PosSession | null>>('/pos/sessions/current')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res.data) {
            this.session = res.data;
            this.sessionLoading = false;
            this.focusSearchInput();
          } else {
            this.openSession();
          }
        },
        error: () => {
          this.openSession();
        },
      });
  }

  private openSession(): void {
    this.api
      .post<ApiResponse<PosSession>>('/pos/sessions', { openingAmount: 0 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.session = res.data;
          this.sessionLoading = false;
          this.notify.success('POS session opened');
          this.focusSearchInput();
        },
        error: (err) => {
          this.sessionLoading = false;
          this.notify.error(
            err.error?.error || 'Failed to open POS session'
          );
        },
      });
  }

  private setupSearch(): void {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query || query.length < 2) {
            this.searchResults = [];
            this.showSearchResults = false;
            return of(null);
          }
          this.searchLoading = true;
          return this.api.get<ApiResponse<ProductVariant[]>>(
            '/pos/products/search',
            { q: query }
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (res) {
            this.searchResults = res.data || [];
            this.showSearchResults = true;
            // Reset keyboard selection — the new result list may be
            // shorter/different and a stale index would point somewhere
            // unexpected or out of bounds.
            this.highlightedResultIndex = -1;
          }
          this.searchLoading = false;
        },
        error: () => {
          this.searchLoading = false;
          this.searchResults = [];
          this.highlightedResultIndex = -1;
        },
      });
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchQuery);
  }

  /**
   * Arrow-key navigation through the results dropdown. Both arrows cycle
   * (wrap around at the edges) so the cashier never hits a dead end, and
   * the highlighted row is scrolled into view so it stays visible even
   * in a long list.
   */
  onSearchArrow(direction: 1 | -1): void {
    if (!this.showSearchResults || this.searchResults.length === 0) return;
    const len = this.searchResults.length;
    // `+ len` keeps the modulo positive for the -1 case.
    this.highlightedResultIndex =
      (this.highlightedResultIndex + direction + len) % len;
    this.scrollHighlightedIntoView();
  }

  private scrollHighlightedIntoView(): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-search-result-index="' + this.highlightedResultIndex + '"]'
      );
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  /**
   * Enter from the search input. Supports three workflows, in priority
   * order:
   *   1. Arrow-key pick — if the cashier navigated the dropdown with
   *      ↑/↓, add the highlighted row.
   *   2. Dropdown already has results — prefer an exact barcode match,
   *      else the first row (keyboard-fast typed search).
   *   3. Dropdown empty (scanner beat the 300ms debounce) — hit the
   *      non-debounced `/pos/lookup/:barcode` for an instant exact match.
   *
   * All paths funnel through `addToCart`, which enforces the out-of-stock
   * guard. After the add, focus returns to the search box so the next
   * scan/keystroke lands in the right place — this is what keeps the
   * "never touch the mouse" workflow usable.
   */
  onSearchEnter(): void {
    const query = this.searchQuery.trim();
    if (!query && this.highlightedResultIndex < 0) return;

    // 1. Keyboard-highlighted row from ↑/↓ navigation.
    if (
      this.highlightedResultIndex >= 0 &&
      this.highlightedResultIndex < this.searchResults.length
    ) {
      this.addToCart(this.searchResults[this.highlightedResultIndex]);
      return;
    }

    // 2. Dropdown has results — prefer exact barcode, else top row.
    if (this.searchResults.length > 0) {
      const exact = this.searchResults.find((v) => v.barcode === query);
      this.addToCart(exact || this.searchResults[0]);
      return;
    }

    // 3. Fall back to direct barcode lookup (scanner outran the debounce).
    this.api
      .get<ApiResponse<ProductVariant>>(
        `/pos/lookup/${encodeURIComponent(query)}`
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res?.data) {
            this.addToCart(res.data);
          } else {
            this.notify.warning(`No product found for "${query}"`);
            this.focusSearchInput();
          }
        },
        error: (err) => {
          this.notify.warning(
            err.error?.error || `No product found for "${query}"`
          );
          this.focusSearchInput();
        },
      });
  }

  // Customer search
  private setupCustomerSearch(): void {
    this.customerSearchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query || query.length < 2) {
            this.customerSearchResults = [];
            this.showCustomerResults = false;
            return of(null);
          }
          this.customerSearchLoading = true;
          return this.api.get<ApiResponse<any[]>>('/customers/search', { query });
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (res) {
            this.customerSearchResults = res.data || [];
            this.showCustomerResults = true;
          }
          this.customerSearchLoading = false;
        },
        error: () => {
          this.customerSearchLoading = false;
          this.customerSearchResults = [];
        },
      });
  }

  onCustomerSearchInput(): void {
    this.customerSearchSubject.next(this.customerSearchQuery);
  }

  selectCustomer(customer: any): void {
    this.selectedCustomer = customer;
    this.customerId = customer.id;
    this.customerSearchQuery = '';
    this.customerSearchResults = [];
    this.showCustomerResults = false;
  }

  clearCustomer(): void {
    this.selectedCustomer = null;
    this.customerId = null;
    this.customerSearchQuery = '';
  }

  closeCustomerResults(): void {
    setTimeout(() => {
      this.showCustomerResults = false;
    }, 200);
  }

  /** Resolve the branch-level stock from whichever shape the variant came in with. */
  getVariantStock(variant: ProductVariant): number {
    return variant.stock ?? variant.inventory?.[0]?.currentStock ?? 0;
  }

  isVariantOutOfStock(variant: ProductVariant): boolean {
    return this.getVariantStock(variant) <= 0;
  }

  addToCart(variant: ProductVariant): void {
    const vid = variant.variantId || variant.id!;
    const existing = this.cart.find((c) => c.variantId === vid);
    const stock = this.getVariantStock(variant);

    // Block 0-stock items outright — the backend would reject checkout
    // with an "Insufficient stock" error, so there's no point letting them
    // land in the cart and surprising the cashier at the end of the sale.
    if (stock <= 0 && !existing) {
      this.notify.warning(
        `${variant.productName || variant.product?.name || 'Item'} is out of stock`
      );
      this.focusSearchInput();
      return;
    }

    if (existing) {
      if (existing.quantity >= existing.maxStock) {
        this.notify.warning('Maximum stock reached');
        this.focusSearchInput();
        return;
      }
      existing.quantity++;
    } else {
      this.cart.push({
        variantId: vid,
        barcode: variant.barcode || variant.sku || '',
        sku: variant.sku || '',
        productName: variant.productName || variant.product?.name || 'Unknown',
        brandName: variant.brand || variant.product?.brand?.name || '',
        size: variant.size || '',
        color: variant.color || '',
        quantity: 1,
        unitPrice: variant.price,
        maxStock: stock,
      });
    }

    this.searchQuery = '';
    this.searchResults = [];
    this.showSearchResults = false;
    this.highlightedResultIndex = -1;
    this.refreshCartOffers();
    // Back to the search box so the next scan/keystroke lands here.
    this.focusSearchInput();
  }

  removeFromCart(index: number): void {
    this.cart.splice(index, 1);
    this.refreshCartOffers();
  }

  incrementQty(item: CartItem): void {
    if (item.quantity < item.maxStock) {
      item.quantity++;
      this.refreshCartOffers();
    }
  }

  decrementQty(item: CartItem): void {
    if (item.quantity > 1) {
      item.quantity--;
      this.refreshCartOffers();
    }
  }

  get subtotal(): number {
    return this.cart.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
  }

  /** Total discount from offers across all cart lines (only qualified lines). */
  get offerDiscountTotal(): number {
    return this.cart.reduce(
      (sum, item) => sum + (item.qualified ? item.offerDiscount ?? 0 : 0),
      0
    );
  }

  // ─── Per-line effective discount (display-only) ──────────────────
  //
  // The customer needs to see what their actual saving is on each
  // individual item — "20% off this jacket" feels more tangible than
  // a single line at the bottom that says "−₹860 on the whole bill".
  //
  // There's no per-line discount *input* though; the cashier still
  // types a single bill-level figure (₹ or %). We just back-compute
  // what share of that bill discount belongs to each line and present
  // it as a %. The share is weighted by the line's post-offer taxable
  // value, matching what the backend does at persistence time.

  /** Line gross (pre-discount) — what the shelf price says × qty. */
  getLineGross(item: CartItem): number {
    return item.unitPrice * item.quantity;
  }

  /**
   * Total rupee reduction applied to a line: the offer discount plus the
   * apportioned share of the bill-level manual discount & round-off. This
   * is what the customer actually saves on this particular item.
   */
  getLineDiscountAmount(item: CartItem): number {
    const gross = this.getLineGross(item);
    const offerDisc =
      item.qualified && item.offerDiscount ? item.offerDiscount : 0;
    const postOffer = gross - offerDisc;

    // Bill-level non-offer discount that needs to be spread across lines.
    // `this.discount` (getter) already includes resolvedDiscount + roundOff.
    const billLevel = this.discount;
    if (billLevel <= 0 || this.discountBase <= 0) {
      return offerDisc;
    }

    const ratio = billLevel / this.discountBase;
    const apportioned = postOffer * ratio;
    // Clamp the total line reduction to the gross — a stray rounding
    // error can't flip a line total negative.
    return Math.min(gross, offerDisc + apportioned);
  }

  /** Effective discount on this line as a percentage of its gross. */
  getLineDiscountPercent(item: CartItem): number {
    const gross = this.getLineGross(item);
    if (gross <= 0) return 0;
    return (this.getLineDiscountAmount(item) / gross) * 100;
  }

  /** Line total after every applicable discount — what the customer pays for it. */
  getLineTotal(item: CartItem): number {
    return Math.max(
      0,
      this.getLineGross(item) - this.getLineDiscountAmount(item)
    );
  }

  /** The base that manual discount / percentage is applied against. */
  get discountBase(): number {
    return Math.max(0, this.subtotal - this.offerDiscountTotal);
  }

  /**
   * Manual discount resolved to a rupee amount, regardless of input mode.
   * Capped at the discount base so a stray "100%" or overshoot can't flip
   * the bill negative. Rounded to whole rupees — fractional discounts are
   * not a thing at the counter.
   */
  get resolvedDiscount(): number {
    const v = this.discountValue ?? 0;
    if (v <= 0) return 0;
    const raw =
      this.discountMode === 'percent' ? (this.discountBase * v) / 100 : v;
    return Math.min(this.discountBase, Math.round(raw));
  }

  /** Payable amount after manual discount, before any round-off. */
  get payableBeforeRound(): number {
    return Math.max(0, this.discountBase - this.resolvedDiscount);
  }

  /**
   * How much would be waived to round *down* to the nearest ₹10. Always
   * an integer (cashiers think in whole rupees), and always ≤ 9. Zero
   * when the payable is already a clean multiple of 10.
   */
  get roundDownAmount(): number {
    const p = Math.round(this.payableBeforeRound);
    return p % 10;
  }

  /**
   * How much would be added to round *up* to the nearest ₹10. Integer,
   * always ≤ 9. Zero when already clean.
   */
  get roundUpAmount(): number {
    const p = Math.round(this.payableBeforeRound);
    const tail = p % 10;
    return tail === 0 ? 0 : 10 - tail;
  }

  /**
   * Live round-off value derived from `roundMode`. Positive = waived (down),
   * negative = surcharge (up). Re-computed on every change detection pass,
   * so edits to the cart or manual discount automatically keep the rounding
   * glued to the current payable.
   */
  get roundOff(): number {
    if (this.roundMode === 'down') return this.roundDownAmount;
    if (this.roundMode === 'up') return -this.roundUpAmount;
    return 0;
  }

  /**
   * Combined reduction applied to the bill: manual discount + round-off.
   * Can be slightly negative when the cashier chose "round up" — in that
   * case the sale total goes *above* the post-discount payable to land on
   * a multiple of ₹10 (the customer pays a tiny surcharge, e.g. ₹7, so the
   * total becomes a clean ₹2760 instead of ₹2753).
   */
  get discount(): number {
    return this.resolvedDiscount + this.roundOff;
  }

  /**
   * "Chhota chhod do" — waive the single-digit tail so the customer pays a
   * round ₹10. Computed against the payable *after* the manual discount, so
   * the cashier can stack: first type a ₹200 discount, then hit round-off
   * to clear the remaining ₹7 tail.
   */
  applyRoundDown(): void {
    this.roundMode = 'down';
  }

  /** Round up to the nearest ₹10. */
  applyRoundUp(): void {
    this.roundMode = 'up';
  }

  clearRoundOff(): void {
    this.roundMode = 'none';
  }

  setDiscountMode(mode: 'amount' | 'percent'): void {
    if (this.discountMode === mode) return;
    this.discountMode = mode;
    // Switching modes: clear the value so a "50" that meant ₹50 doesn't
    // silently become 50%. Also drops the round-off which was computed
    // against the old discount amount.
    this.discountValue = null;
    this.roundMode = 'none';
  }

  /**
   * GST component extracted from the inclusive MRPs after discounts.
   *
   * Clothing prices on hang-tags are tax-inclusive (MRP) — the customer
   * pays the shelf price, and GST is already baked into it. We extract
   * the tax portion purely for display and for the backend to persist as
   * `Sale.taxAmount` (needed for GSTR-1 filings).
   *
   *   net = inclusive / (1 + rate)
   *   tax = inclusive − net = inclusive × rate / (1 + rate)
   */
  get taxAmount(): number {
    const payable = this.subtotal - this.offerDiscountTotal - this.discount;
    return (payable * this.taxRate) / (1 + this.taxRate);
  }

  /**
   * What the customer actually pays — no tax is added on top because it's
   * already inside `subtotal`.
   */
  get total(): number {
    return this.subtotal - this.offerDiscountTotal - this.discount;
  }

  // ─── Derived split-tender state ──────────────────────────────────

  /** Sum of amounts already applied to the bill by confirmed tenders. */
  get amountPaid(): number {
    return this.tenders.reduce((sum, t) => sum + t.amount, 0);
  }

  /** How much is still owed. Clamped at zero so the UI never shows negative. */
  get remaining(): number {
    return Math.max(0, Math.round((this.total - this.amountPaid) * 100) / 100);
  }

  /**
   * Change due = cash received across all cash tenders minus what those
   * tenders actually applied to the bill. For a typical single-cash flow
   * this is just `cashReceived - remaining`; for split payments it's the
   * total over-tender across every cash entry.
   */
  get changeDue(): number {
    let change = 0;
    for (const t of this.tenders) {
      if (t.method === 'cash' && t.cashReceived != null) {
        change += Math.max(0, t.cashReceived - t.amount);
      }
    }
    return Math.round(change * 100) / 100;
  }

  /** Pending amount defaulted to the remaining balance if the cashier hasn't typed one yet. */
  get effectivePendingAmount(): number {
    return this.pendingAmount != null ? this.pendingAmount : this.remaining;
  }

  get canCheckout(): boolean {
    if (this.cart.length === 0) return false;
    if (this.checkoutLoading) return false;
    return this.amountPaid + 0.0001 >= this.total;
  }

  // ─── Tender management ──────────────────────────────────────────

  selectPendingMethod(method: 'cash' | 'card' | 'upi'): void {
    this.pendingMethod = method;
    // Reset the typed amount so the default (= remaining) kicks in again.
    this.pendingAmount = null;
  }

  /**
   * Add a tender to the sale. For cash the entered amount is treated as
   * "received from customer" — if it exceeds the remaining balance, the
   * tender's `amount` is clamped to remaining and the excess becomes change.
   * Non-cash methods are clamped to remaining silently (over-tender on UPI
   * or card doesn't make sense — it would just get refused by the gateway).
   */
  addTender(): void {
    if (this.remaining <= 0) return;
    const entered = this.effectivePendingAmount;
    if (!entered || entered <= 0) return;

    if (this.pendingMethod === 'cash') {
      const covering = Math.min(entered, this.remaining);
      this.tenders.push({
        method: 'cash',
        amount: Math.round(covering * 100) / 100,
        cashReceived: Math.round(entered * 100) / 100,
      });
    } else {
      const capped = Math.min(entered, this.remaining);
      this.tenders.push({
        method: this.pendingMethod,
        amount: Math.round(capped * 100) / 100,
      });
    }

    // Reset the pending entry so the next add-tender starts fresh.
    // Snap the method back to cash — the remaining balance always defaults to
    // cash because that's the most common "finish the sale" path (customer
    // tapped UPI for part of it, hands over cash for the rest). The cashier
    // can still click Card/UPI explicitly if they need to split further.
    this.pendingAmount = null;
    this.pendingMethod = 'cash';
  }

  removeTender(index: number): void {
    this.tenders.splice(index, 1);
  }

  /**
   * Set the pending amount to exactly cover the remaining balance — wired to
   * the "Exact" quick button. After this, clicking "Add" finishes the sale
   * in one step for single-method payments.
   */
  payRemainingInPending(): void {
    this.pendingAmount = this.remaining;
  }

  completeSale(): void {
    if (!this.canCheckout) return;

    this.checkoutLoading = true;

    const body: any = {
      items: this.cart.map((item) => ({
        barcode: item.barcode,
        quantity: item.quantity,
      })),
      payments: this.tenders.map((t) => ({
        method: t.method,
        amount: t.amount,
      })),
    };

    // Sent even when negative — round-up surcharges encode as a negative
    // "discount" so the backend total rises to the nearest ₹10.
    if (this.discount !== 0) body.discountAmount = this.discount;
    if (this.customerId) body.customerId = this.customerId;

    this.api
      .post<ApiResponse<any>>('/pos/checkout', body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.checkoutLoading = false;
          const saleId = res.data?.sale?.id || res.data?.id;
          this.notify.success(
            `Sale completed! ${res.data?.saleNumber || ''}`
          );
          if (saleId) {
            this.receiptPrint.printReceipt(saleId);
          }
          this.resetCart();
        },
        error: (err) => {
          this.checkoutLoading = false;
          this.notify.error(
            err.error?.error || 'Checkout failed. Please try again.'
          );
        },
      });
  }

  private resetCart(): void {
    this.cart = [];
    this.discountMode = 'amount';
    this.discountValue = null;
    this.roundMode = 'none';
    this.tenders = [];
    this.pendingMethod = 'cash';
    this.pendingAmount = null;
    this.customerId = null;
    this.selectedCustomer = null;
    this.customerSearchQuery = '';
  }

  closeSearchResults(): void {
    setTimeout(() => {
      this.showSearchResults = false;
    }, 200);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  getVariantLabel(variant: ProductVariant): string {
    const parts: string[] = [];
    if (variant.size) parts.push(variant.size);
    if (variant.color) parts.push(variant.color);
    return parts.join(' / ');
  }

  getItemVariantLabel(item: CartItem): string {
    const parts: string[] = [];
    if (item.size) parts.push(item.size);
    if (item.color) parts.push(item.color);
    return parts.join(' / ');
  }
}
