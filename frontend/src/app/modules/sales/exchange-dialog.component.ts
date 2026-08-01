import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface ReturnItem {
  saleItemId: number;
  productName: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  maxQuantity: number;
  quantity: number;
  reason: string;
  condition: string;
  selected: boolean;
  unitPrice: number;
}

interface NewItem {
  variantId: number;
  productName: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
}

// Shape returned by both /pos/products/search and /pos/lookup/:code — flat.
interface SearchResult {
  variantId: number;
  sku: string;
  barcode: string;
  size?: string;
  color?: string;
  price: number;
  productName: string;
}

@Component({
  selector: 'app-exchange-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './exchange-dialog.component.html',
})
export class ExchangeDialogComponent implements OnInit {
  @Input() sale: any;
  @Input() returnableItems: any[] = [];
  @Output() close = new EventEmitter<void>();
  @Output() exchangeComplete = new EventEmitter<void>();

  items: ReturnItem[] = [];
  newItems: NewItem[] = [];
  submitting = false;

  // Search
  searchQuery = '';
  searchResults: SearchResult[] = [];
  searching = false;
  showResults = false;

  reasons = [
    { value: 'defective', label: 'Defective' },
    { value: 'wrong_size', label: 'Wrong Size' },
    { value: 'not_as_described', label: 'Not as Described' },
    { value: 'changed_mind', label: 'Changed Mind' },
    { value: 'other', label: 'Other' },
  ];

  conditions = [
    { value: 'new', label: 'New / Unused' },
    { value: 'worn', label: 'Worn' },
    { value: 'damaged', label: 'Damaged' },
  ];

  private searchTimeout: any;

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.items = this.returnableItems.map((item) => ({
      saleItemId: item.id,
      productName: item.variant?.product?.name || item.productName || item.name || 'Unknown',
      sku: item.variant?.sku || item.sku || '-',
      barcode: item.variant?.barcode || item.barcode || '-',
      size: item.variant?.size || '-',
      color: item.variant?.color || '-',
      maxQuantity: item.quantity - (item.returnedQuantity || 0),
      quantity: 1,
      reason: 'wrong_size',
      condition: 'new',
      selected: false,
      unitPrice: item.unitPrice || 0,
    }));
  }

  get selectedItems(): ReturnItem[] {
    return this.items.filter((i) => i.selected);
  }

  get returnTotal(): number {
    return this.selectedItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
  }

  get newItemsTotal(): number {
    return this.newItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
  }

  get priceDifference(): number {
    return this.newItemsTotal - this.returnTotal;
  }

  get canSubmit(): boolean {
    return this.selectedItems.length > 0 && this.newItems.length > 0 && !this.submitting;
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  }

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: Event): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  onSearchInput(): void {
    clearTimeout(this.searchTimeout);
    if (!this.searchQuery || this.searchQuery.length < 2) {
      this.searchResults = [];
      this.showResults = false;
      return;
    }
    this.searchTimeout = setTimeout(() => this.searchProducts(), 300);
  }

  searchProducts(): void {
    this.searching = true;
    this.api
      .get<any>('/pos/products/search', { q: this.searchQuery })
      .subscribe({
        next: (res) => {
          this.searchResults = res.data || [];
          this.showResults = true;
          this.searching = false;
        },
        error: () => {
          this.searchResults = [];
          this.searching = false;
        },
      });
  }

  addNewItem(result: SearchResult): void {
    const existing = this.newItems.find((i) => i.variantId === result.variantId);
    if (existing) {
      existing.quantity++;
    } else {
      this.newItems.push({
        variantId: result.variantId,
        productName: result.productName || 'Unknown',
        sku: result.sku || '-',
        barcode: result.barcode || '-',
        size: result.size || '-',
        color: result.color || '-',
        quantity: 1,
        unitPrice: Number(result.price),
      });
    }
    this.searchQuery = '';
    this.showResults = false;
    this.searchResults = [];
  }

  // Manual barcode/SKU entry: pressing Enter looks up an EXACT barcode-or-SKU
  // match via /pos/lookup/:code and adds it directly (scanner and keyboard both
  // land here). Falls back to the single search result when there's exactly one.
  onSearchEnter(): void {
    const code = this.searchQuery.trim();
    if (!code) return;
    clearTimeout(this.searchTimeout);
    this.searching = true;
    this.api.get<any>('/pos/lookup/' + encodeURIComponent(code)).subscribe({
      next: (res) => {
        this.searching = false;
        if (res?.data) {
          this.addNewItem(res.data as SearchResult);
        } else if (this.searchResults.length === 1) {
          this.addNewItem(this.searchResults[0]);
        } else {
          this.notify.error('No exact barcode/SKU match — pick from the list');
        }
      },
      error: () => {
        this.searching = false;
        // Not an exact code — if the substring search already found one row, take it.
        if (this.searchResults.length === 1) {
          this.addNewItem(this.searchResults[0]);
        } else {
          this.notify.error('No product found for "' + code + '"');
        }
      },
    });
  }

  removeNewItem(index: number): void {
    this.newItems.splice(index, 1);
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.submitting = true;

    // Exchange is typically a return + new sale; using the return endpoint
    const body = {
      items: this.selectedItems.map((item) => ({
        saleItemId: item.saleItemId,
        quantity: item.quantity,
        reason: item.reason,
        condition: item.condition,
      })),
      exchangeItems: this.newItems.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    };

    this.api.post(`/sales/${this.sale.id}/return`, body).subscribe({
      next: () => {
        this.submitting = false;
        this.exchangeComplete.emit();
      },
      error: () => {
        this.notify.error('Failed to process exchange');
        this.submitting = false;
      },
    });
  }
}
