import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

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
  size: string;
  color: string;
  productName: string;
  mrp: number | string | null;
  clearancePrice: number | string | null;
}

interface SearchResult {
  variantId: number;
  sku: string;
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
  label: string;
  mrp: number | null;
  currentPrice: number | null;
  clearancePrice: number | null;
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

  loading = false;
  applying = false;
  items: ClearanceItem[] = [];

  searchQuery = '';
  searchResults: SearchResult[] = [];
  searching = false;
  showResults = false;

  pending: PendingRow[] = [];

  constructor(private api: ApiService, private notification: NotificationService) {}

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
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load clearance items');
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
    this.pending.push({
      variantId: vid,
      sku: r.sku,
      label,
      mrp: r.mrp != null ? Number(r.mrp) : null,
      currentPrice: r.price != null ? Number(r.price) : null,
      clearancePrice: null,
    });
    this.searchQuery = '';
    this.searchResults = [];
    this.showResults = false;
  }

  removePending(i: number): void {
    this.pending.splice(i, 1);
  }

  get canApply(): boolean {
    return this.pending.length > 0 && this.pending.every((p) => (p.clearancePrice ?? 0) > 0);
  }

  applyClearance(): void {
    if (!this.canApply || this.applying) return;
    this.applying = true;
    const items = this.pending.map((p) => ({ variantId: p.variantId, clearancePrice: Number(p.clearancePrice) }));
    this.api
      .post<any>('/inventory/clearance', { items })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.applying = false;
          this.notification.success(`${items.length} SKU(s) put on clearance`);
          this.pending = [];
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
        },
        error: (err) => this.notification.error(err.error?.error || 'Failed to remove'),
      });
  }

  num(v: number | string | null): number {
    return v != null ? Number(v) : 0;
  }
}
