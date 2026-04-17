import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { VendorPickerComponent } from '../vendors/vendor-picker.component';

interface BarcodeItem {
  variantId: number;
  sku: string;
  productName: string;
  variantLabel: string;
  price: number;
  copies: number;
}

interface VariantSearchResult {
  variantId?: number;
  id?: number;
  sku: string;
  size?: string;
  color?: string;
  price?: number;
  productName?: string;
  brand?: string;
  barcode?: string;
  stock?: number;
  product?: { name: string; basePrice: number };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-barcodes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent, VendorPickerComponent],
  templateUrl: './barcodes.component.html',
})
export class BarcodesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

  queue: BarcodeItem[] = [];
  searchQuery = '';
  searchResults: VariantSearchResult[] = [];
  showResults = false;
  searching = false;
  printing = false;

  // Direct barcode lookup
  barcodeInput = '';

  // Browse & filter (like history page)
  showBrowse = false;
  browseSearch = '';
  browseLotCode = '';
  browseVendorId: number | null = null;
  browseStartDate = '';
  browseEndDate = '';
  browseType = 'purchase';
  browseResults: any[] = [];
  browseLoading = false;
  browseTotal = 0;
  private browseTimer: any = null;

  constructor(
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query || query.length < 2) {
            this.searchResults = [];
            this.showResults = false;
            return of(null);
          }
          this.searching = true;
          return this.api.get<ApiResponse<VariantSearchResult[]>>('/pos/products/search', { q: query });
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (res) {
            this.searchResults = res.data ?? [];
            this.showResults = this.searchResults.length > 0;
          }
          this.searching = false;
        },
        error: () => (this.searching = false),
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    this.searchSubject.next(value);
  }

  onBarcodeLookup(): void {
    if (!this.barcodeInput.trim()) return;
    const sku = this.barcodeInput.trim();

    this.api
      .get<ApiResponse<VariantSearchResult[]>>('/pos/products/search', { q: sku })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const results = res.data ?? [];
          const match = results.find((v) => v.sku === sku);
          if (match) {
            this.addToQueue(match);
          } else if (results.length > 0) {
            this.addToQueue(results[0]);
          } else {
            this.notification.warning('No product found for barcode: ' + sku);
          }
          this.barcodeInput = '';
        },
        error: () => this.notification.error('Lookup failed'),
      });
  }

  selectVariant(variant: VariantSearchResult): void {
    this.addToQueue(variant);
    this.closeSearch();
  }

  private addToQueue(variant: VariantSearchResult): void {
    const vid = variant.variantId || variant.id!;
    const existing = this.queue.find((i) => i.variantId === vid);
    if (existing) {
      existing.copies++;
      return;
    }

    const parts: string[] = [];
    if (variant.size) parts.push(variant.size);
    if (variant.color) parts.push(variant.color);

    this.queue.push({
      variantId: vid,
      sku: variant.barcode || variant.sku,
      productName: variant.productName || variant.product?.name || 'Unknown',
      variantLabel: parts.join(' / ') || '',
      price: variant.price || variant.product?.basePrice || 0,
      copies: 1,
    });

  }

  closeSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.showResults = false;
  }

  removeFromQueue(index: number): void {
    this.queue.splice(index, 1);
  }

  updateCopies(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (value > 0) {
      this.queue[index].copies = value;
    }
  }

  get totalStickers(): number {
    return this.queue.reduce((sum, item) => sum + item.copies, 0);
  }

  get expandedQueue(): BarcodeItem[] {
    const expanded: BarcodeItem[] = [];
    for (const item of this.queue) {
      for (let i = 0; i < item.copies; i++) {
        expanded.push(item);
      }
    }
    return expanded;
  }

  printBarcodes(): void {
    if (this.queue.length === 0 || this.printing) return;

    const items = this.queue.map((item) => ({
      sku: item.sku,
      productName: item.productName,
      variantLabel: item.variantLabel || undefined,
      price: item.price,
      copies: item.copies,
    }));

    this.printing = true;
    // Uses the new printing module. With no profileId/templateId supplied,
    // the backend picks the branch's default printer profile and its default
    // template (configured in Settings → Printers & Labels).
    this.api
      .post<ApiResponse<{ labelsPrinted: number; itemCount: number; driver: string; transport: string }>>(
        '/printing/print',
        { items }
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const count = res.data?.labelsPrinted ?? this.totalStickers;
          const driver = res.data?.driver ?? '';
          this.notification.success(`Printed ${count} label(s) via ${driver}`);
          this.printing = false;
        },
        error: () => {
          this.printing = false;
        },
      });
  }

  // ─── Browse & Filter ──────────────────────────────────────

  loadBrowse(): void {
    this.browseLoading = true;
    const params: Record<string, string> = {
      page: '1',
      limit: '200',
    };
    if (this.browseType) params['type'] = this.browseType;
    if (this.browseSearch.trim()) params['search'] = this.browseSearch.trim();
    if (this.browseLotCode.trim()) params['lotCode'] = this.browseLotCode.trim();
    if (this.browseVendorId) params['vendorId'] = String(this.browseVendorId);
    if (this.browseStartDate) params['startDate'] = this.browseStartDate;
    if (this.browseEndDate) params['endDate'] = this.browseEndDate;

    this.api
      .get<any>('/inventory/movements', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.browseResults = res.data || [];
          this.browseTotal = res.meta?.total || 0;
          this.browseLoading = false;
        },
        error: () => {
          this.browseLoading = false;
        },
      });
  }

  onBrowseFilterChange(): void {
    this.loadBrowse();
  }

  onBrowseSearchInput(): void {
    if (this.browseTimer) clearTimeout(this.browseTimer);
    this.browseTimer = setTimeout(() => this.loadBrowse(), 400);
  }

  onBrowseLotInput(): void {
    if (this.browseTimer) clearTimeout(this.browseTimer);
    this.browseTimer = setTimeout(() => this.loadBrowse(), 400);
  }

  onBrowseVendorChange(id: number | null): void {
    this.browseVendorId = id;
    this.loadBrowse();
  }

  addBrowseResultToQueue(m: any): void {
    const vid = m.variant?.id || m.variantId;
    const existing = this.queue.find((i) => i.variantId === vid);
    if (existing) {
      existing.copies += Math.abs(m.quantity || 1);
      return;
    }

    const v = m.variant;
    const parts: string[] = [];
    if (v?.size) parts.push(v.size);
    if (v?.color) parts.push(v.color);

    this.queue.push({
      variantId: vid,
      sku: v?.barcode || v?.sku || '',
      productName: v?.product?.name || 'Unknown',
      variantLabel: parts.join(' / ') || '',
      price: Number(v?.priceOverride || v?.product?.basePrice || 0),
      copies: Math.abs(m.quantity || 1),
    });
  }

  addAllBrowseResults(): void {
    for (const m of this.browseResults) {
      if (m.quantity > 0) {
        this.addBrowseResultToQueue(m);
      }
    }
    this.notification.success(`Added ${this.browseResults.length} item(s) to queue`);
  }

  toggleBrowse(): void {
    this.showBrowse = !this.showBrowse;
    if (this.showBrowse && this.browseResults.length === 0) {
      this.loadBrowse();
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
}
