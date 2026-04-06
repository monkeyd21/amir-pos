import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

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
  imports: [CommonModule, FormsModule, PageHeaderComponent],
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

  // Direct barcode lookup
  barcodeInput = '';

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
    const expanded = this.expandedQueue;
    if (expanded.length === 0) return;

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      this.notification.error('Pop-up blocked. Please allow pop-ups for printing.');
      return;
    }

    const stickersHtml = expanded
      .map(
        (item) => `
        <div class="sticker">
          <p class="name">${item.productName}</p>
          ${item.variantLabel ? `<p class="variant">${item.variantLabel}</p>` : ''}
          <svg id="bc-${Math.random().toString(36).slice(2)}" data-sku="${item.sku}"></svg>
          <p class="price">${this.formatCurrency(item.price)}</p>
        </div>`
      )
      .join('');

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Print Barcodes - Atelier</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', Arial, sans-serif; padding: 5mm; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
    .sticker {
      border: 1px dashed #ccc;
      padding: 3mm;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .name { font-weight: 700; font-size: 9pt; margin-bottom: 2mm; }
    .variant { font-size: 7pt; color: #555; margin-bottom: 1mm; }
    .price { font-weight: 700; font-size: 9pt; margin-top: 1mm; }
    svg { max-width: 100%; height: auto; }
    @media print {
      body { padding: 0; }
      .grid { gap: 2mm; }
    }
  </style>
</head>
<body>
  <div class="grid">${stickersHtml}</div>
  <script>
    document.querySelectorAll('svg[data-sku]').forEach(function(svg) {
      try {
        JsBarcode(svg, svg.getAttribute('data-sku'), {
          format: 'CODE128', width: 1.5, height: 40,
          displayValue: true, fontSize: 10, margin: 2,
          background: '#fff', lineColor: '#000'
        });
      } catch(e) {}
    });
    setTimeout(function() { window.print(); }, 300);
  <\/script>
</body>
</html>`);
    printWindow.document.close();
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
