import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { LabelPrintService } from '../../shared/label-print.service';

/**
 * §2.4 — Clearance (dead-stock liquidation). Owner flags stale SKUs to sell at a
 * fixed low price. Clearance lines are enforced backend-side: the fixed price is
 * used at POS, ALL discounts/offers are locked to zero, and the line is
 * non-returnable, non-exchangeable and non-refundable. This screen just manages
 * which SKUs are on clearance and at what price.
 */
interface ClearanceItem {
  variantId: number;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  productName: string;
  mrp: number | string | null;
  purchasePrice: number | string | null;
  clearancePrice: number | string | null;
  stock?: number | string | null;
}

// §Clearance — a clearance article that has been sold at least once (net of
// returns). Populated from the /inventory/clearance/sold endpoint.
interface SoldClearanceItem {
  variantId: number;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  productName: string;
  mrp: number | string | null;
  clearancePrice: number | string | null;
  purchasePrice: number | string | null;
  quantitySold: number;
  stillOnClearance: boolean;
  sales: { saleNumber: string; date: string }[];
}

interface SearchResult {
  variantId: number;
  productId?: number;
  sku: string;
  barcode?: string;
  size?: string;
  color?: string;
  productName?: string;
  price?: number;
  mrp?: number | null;
  stock?: number;
}

interface PendingRow {
  variantId: number;
  sku: string;
  barcode: string;
  label: string;
  mrp: number | null;
  purchasePrice: number | null;
  currentPrice: number | null;
  clearancePrice: number | null;
  // §Clearance bulk — whole-line adds are pre-checked; the owner can uncheck
  // individual size/colour variants to exclude them before applying.
  include: boolean;
}

@Component({
  selector: 'app-clearance',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clearance.component.html',
})
export class ClearanceComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private search$ = new Subject<string>();

  // §Clearance — in-page tabs: active (still-in-stock) vs sold-through articles.
  activeTab: 'active' | 'sold' = 'active';

  loading = false;
  applying = false;
  items: ClearanceItem[] = [];

  // Sold Articles tab state.
  soldItems: SoldClearanceItem[] = [];
  soldLoading = false;
  soldLoaded = false;

  searchQuery = '';
  searchResults: SearchResult[] = [];
  searching = false;
  showResults = false;

  pending: PendingRow[] = [];
  bulkPrice: number | null = null;
  addingLine = false;

  selectedIds = new Set<number>();
  printing = false;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private labelPrint: LabelPrintService
  ) {}

  ngOnInit(): void {
    this.loadClearance();
    this.search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          const query = q.trim();
          if (query.length < 2) {
            this.searching = false;
            this.searchResults = [];
            return of({ data: [] } as any);
          }
          this.searching = true;
          return this.api.get<any>('/pos/products/search', { q: query });
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          this.searchResults = res?.data ?? [];
          this.showResults = this.searchResults.length > 0;
          this.searching = false;
        },
        error: () => (this.searching = false),
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadClearance(): void {
    this.loading = true;
    this.api
      .get<any>('/inventory/clearance')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.items = res?.data ?? [];
          this.selectedIds.clear();
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load clearance items');
        },
      });
  }

  // §Clearance — switch between the Active and Sold Articles tabs. The sold
  // list is fetched lazily the first time its tab is opened.
  selectTab(tab: 'active' | 'sold'): void {
    this.activeTab = tab;
    if (tab === 'sold' && !this.soldLoaded && !this.soldLoading) this.loadSold();
  }

  loadSold(): void {
    this.soldLoading = true;
    this.api
      .get<any>('/inventory/clearance/sold')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.soldItems = res?.data ?? [];
          this.soldLoaded = true;
          this.soldLoading = false;
        },
        error: () => {
          this.soldLoading = false;
          this.notification.error('Failed to load sold clearance articles');
        },
      });
  }

  onSearchInput(): void {
    this.search$.next(this.searchQuery);
  }

  addToPending(r: SearchResult): void {
    const vid = r.variantId;
    if (this.pending.some((p) => p.variantId === vid) || this.items.some((i) => i.variantId === vid)) {
      this.notification.info('Already on the list');
      return;
    }
    const label = [r.productName, [r.size, r.color].filter(Boolean).join(' / ')].filter(Boolean).join(' — ');
    const row: PendingRow = {
      variantId: vid,
      sku: r.sku,
      barcode: r.barcode ?? '',
      label,
      mrp: r.mrp != null ? Number(r.mrp) : null,
      purchasePrice: null, // POS search omits cost; fetched below from the product
      currentPrice: r.price != null ? Number(r.price) : null,
      clearancePrice: null,
      include: true,
    };
    // Recent-first: the just-scanned article goes to the TOP of the pending list.
    this.pending.unshift(row);
    // Cost isn't in the POS search payload (kept out so cashiers can't see it);
    // fetch it from the owner-only product endpoint and fill the row in place.
    if (r.productId) this.fillPurchasePrice(row, r.productId);
    this.searchQuery = '';
    this.searchResults = [];
    this.showResults = false;
  }

  /** Fetch a variant's cost from /products/:id and set it on an existing row. */
  private fillPurchasePrice(row: PendingRow, productId: number): void {
    this.api
      .get<any>(`/products/${productId}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const product = res?.data;
          const v = (product?.variants ?? []).find((x: any) => x.id === row.variantId);
          if (!v) return;
          const productCost = product?.costPrice != null ? Number(product.costPrice) : null;
          const cost = v.costOverride != null ? Number(v.costOverride) : productCost;
          row.purchasePrice = cost != null ? Number(cost) : null;
        },
        error: () => {
          /* leave purchase as "—" if the lookup fails */
        },
      });
  }

  /**
   * §Clearance bulk — add an ENTIRE stock line (all size/colour variants of the
   * chosen product) to the pending list in one action. Each variant lands as a
   * pre-checked row the owner can uncheck to exclude. Variants already on
   * clearance (or already pending) are skipped.
   */
  addWholeLine(r: SearchResult): void {
    if (this.addingLine) return;
    const productId = r.productId;
    if (!productId) {
      // Fall back to the single variant if the search result lacks a product id.
      this.addToPending(r);
      return;
    }
    this.addingLine = true;
    this.api
      .get<any>(`/products/${productId}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const product = res?.data;
          const variants: any[] = product?.variants ?? [];
          const productMrp = product?.mrp != null ? Number(product.mrp) : null;
          const productBase = product?.basePrice != null ? Number(product.basePrice) : null;
          const productCost = product?.costPrice != null ? Number(product.costPrice) : null;
          const newRows: PendingRow[] = [];
          for (const v of variants) {
            if (v.isActive === false) continue;
            if (v.clearanceFlag) continue; // already on clearance
            if (this.pending.some((p) => p.variantId === v.id)) continue;
            if (newRows.some((p) => p.variantId === v.id)) continue;
            if (this.items.some((i) => i.variantId === v.id)) continue;
            const mrp = v.mrpOverride != null ? Number(v.mrpOverride) : productMrp ?? productBase;
            const cost = v.costOverride != null ? Number(v.costOverride) : productCost;
            const label = [product?.name, [v.size, v.color].filter(Boolean).join(' / ')]
              .filter(Boolean)
              .join(' — ');
            newRows.push({
              variantId: v.id,
              sku: v.sku,
              barcode: v.barcode ?? '',
              label,
              mrp: mrp != null ? Number(mrp) : null,
              purchasePrice: cost != null ? Number(cost) : null,
              currentPrice: mrp != null ? Number(mrp) : null,
              clearancePrice: null,
              include: true,
            });
          }
          // Recent-first: the just-added line lands at the TOP of the pending list.
          this.pending.unshift(...newRows);
          const added = newRows.length;
          this.addingLine = false;
          this.searchQuery = '';
          this.searchResults = [];
          this.showResults = false;
          if (added === 0) this.notification.info('All variants of this line are already listed or on clearance');
          else this.notification.success(`Added ${added} variant(s) — tick/untick, set a price, then apply`);
        },
        error: (err) => {
          this.addingLine = false;
          this.notification.error(err.error?.error || 'Failed to load product variants');
        },
      });
  }

  removePending(i: number): void {
    this.pending.splice(i, 1);
  }

  /** Fill every included pending row's clearance price with the bulk value. */
  applyBulkPrice(): void {
    const price = Number(this.bulkPrice);
    if (!(price > 0)) return;
    for (const p of this.pending) if (p.include) p.clearancePrice = price;
  }

  get includedPending(): PendingRow[] {
    return this.pending.filter((p) => p.include);
  }

  get allPendingSelected(): boolean {
    return this.pending.length > 0 && this.pending.every((p) => p.include);
  }

  /** Select-all / deselect-all toggle above the pending rows. */
  togglePendingAll(): void {
    const target = !this.allPendingSelected;
    for (const p of this.pending) p.include = target;
  }

  get canApply(): boolean {
    const inc = this.includedPending;
    return inc.length > 0 && inc.every((p) => (p.clearancePrice ?? 0) > 0);
  }

  applyClearance(): void {
    if (!this.canApply || this.applying) return;
    this.applying = true;
    const items = this.includedPending.map((p) => ({
      variantId: p.variantId,
      clearancePrice: Number(p.clearancePrice),
    }));
    this.api
      .post<any>('/inventory/clearance', { items })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.applying = false;
          this.notification.success(`${items.length} SKU(s) put on clearance`);
          this.pending = [];
          this.bulkPrice = null;
          this.soldLoaded = false; // sold tab may now include newly-flagged SKUs
          this.loadClearance();
        },
        error: (err) => {
          this.applying = false;
          this.notification.error(err.error?.error || 'Failed to apply clearance');
        },
      });
  }

  removeFromClearance(item: ClearanceItem): void {
    this.api
      .delete<any>(`/inventory/clearance/${item.variantId}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notification.success(`${item.sku} removed from clearance`);
          this.items = this.items.filter((i) => i.variantId !== item.variantId);
          this.selectedIds.delete(item.variantId);
        },
        error: (err) => this.notification.error(err.error?.error || 'Failed to remove'),
      });
  }

  // ── Selection + barcode printing ──────────────────────────
  toggleSelect(variantId: number): void {
    if (this.selectedIds.has(variantId)) this.selectedIds.delete(variantId);
    else this.selectedIds.add(variantId);
  }

  isSelected(variantId: number): boolean {
    return this.selectedIds.has(variantId);
  }

  get allSelected(): boolean {
    return this.items.length > 0 && this.selectedIds.size === this.items.length;
  }

  toggleSelectAll(): void {
    if (this.allSelected) this.selectedIds.clear();
    else this.selectedIds = new Set(this.items.map((i) => i.variantId));
  }

  printSelected(): void {
    if (this.printing || this.selectedIds.size === 0) return;
    const labels = this.items
      .filter((i) => this.selectedIds.has(i.variantId))
      .map((i) => ({
        sku: i.sku,
        productName: i.productName,
        variantLabel: [i.size, i.color].filter(Boolean).join(' / ') || undefined,
        price: this.num(i.clearancePrice),
        mrp: this.num(i.mrp) || undefined,
        clearance: true,
        copies: 1,
      }));
    this.printing = true;
    this.labelPrint
      .print(labels)
      .then((res) => {
        this.notification.success(`Printed ${res.labelsPrinted} clearance label(s) via ${res.driver}`);
        this.printing = false;
      })
      .catch((err) => {
        this.notification.error(err?.message || 'Failed to print labels');
        this.printing = false;
      });
  }

  num(v: number | string | null): number {
    return v != null ? Number(v) : 0;
  }
}
