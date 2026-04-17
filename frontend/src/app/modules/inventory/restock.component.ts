import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { VendorPickerComponent } from '../vendors/vendor-picker.component';

interface Variant {
  id: number;
  sku: string;
  size: string;
  color: string;
  barcode: string;
  priceOverride: number | null;
  isActive: boolean;
  inventory: { quantity: number; branchId: number }[];
}

interface Product {
  id: number;
  name: string;
  basePrice: number;
  costPrice: number;
  landingPrice: number | null;
  taxRate: number;
  description: string | null;
  brand: { id: number; name: string };
  category: { id: number; name: string };
  variants: Variant[];
}

interface RestockRow {
  variantId: number;
  sku: string;
  size: string;
  color: string;
  currentStock: number;
  addQty: number;
}

@Component({
  selector: 'app-restock',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    PageHeaderComponent,
    VendorPickerComponent,
  ],
  templateUrl: './restock.component.html',
})
export class RestockComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  productId!: number;
  product: Product | null = null;
  loading = true;
  saving = false;

  vendorId: number | null = null;
  lotCode = '';
  notes = '';

  // Post-restock print flow
  restockDone = false;
  restockedItems: RestockRow[] = [];
  printCopies: Map<number, number> = new Map();
  printing = false;

  rows: RestockRow[] = [];
  sortBy: 'size' | 'color' = 'size';

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.productId = Number(this.route.snapshot.paramMap.get('id'));
    this.loadProduct();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadProduct(): void {
    this.api
      .get<any>(`/products/${this.productId}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.product = res.data;
          this.buildRows();
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load product');
        },
      });
  }

  private buildRows(): void {
    if (!this.product) return;
    this.rows = this.product.variants
      .filter((v) => v.isActive)
      .map((v) => ({
        variantId: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        currentStock: v.inventory?.[0]?.quantity ?? 0,
        addQty: 0,
      }));
    this.applySorting();
  }

  applySorting(): void {
    this.rows.sort((a, b) => {
      if (this.sortBy === 'color') {
        const cc = a.color.localeCompare(b.color);
        return cc !== 0 ? cc : a.size.localeCompare(b.size);
      }
      const sc = a.size.localeCompare(b.size);
      return sc !== 0 ? sc : a.color.localeCompare(b.color);
    });
  }

  onSortChange(by: 'size' | 'color'): void {
    this.sortBy = by;
    this.applySorting();
  }

  get totalUnits(): number {
    return this.rows.reduce((sum, r) => sum + (r.addQty || 0), 0);
  }

  get variantsWithQty(): number {
    return this.rows.filter((r) => r.addQty > 0).length;
  }

  get isValid(): boolean {
    return (
      this.vendorId !== null &&
      this.lotCode.trim().length > 0 &&
      this.totalUnits > 0
    );
  }

  setAllQty(qty: number): void {
    for (const row of this.rows) {
      row.addQty = qty;
    }
  }

  onSubmit(): void {
    if (!this.isValid || this.saving) return;
    this.saving = true;

    const items = this.rows
      .filter((r) => r.addQty > 0)
      .map((r) => ({ variantId: r.variantId, quantity: r.addQty }));

    this.api
      .post<any>('/inventory/restock', {
        productId: this.productId,
        vendorId: this.vendorId,
        lotCode: this.lotCode.trim(),
        notes: this.notes.trim() || undefined,
        items,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.notification.success(
            res.message || `Restocked ${items.length} variant(s)`
          );
          this.restockedItems = this.rows.filter((r) => r.addQty > 0);
          for (const r of this.restockedItems) {
            this.printCopies.set(r.variantId, r.addQty);
          }
          this.restockDone = true;
        },
        error: (err) => {
          this.saving = false;
          this.notification.error(
            err.error?.error || err.error?.message || 'Restock failed'
          );
        },
      });
  }

  onPrintCopiesChange(variantId: number, value: number): void {
    this.printCopies.set(variantId, Math.max(0, Math.floor(value || 0)));
  }

  get totalPrintLabels(): number {
    let sum = 0;
    this.printCopies.forEach((c) => (sum += c));
    return sum;
  }

  printLabels(): void {
    if (!this.product || this.restockedItems.length === 0 || this.printing) return;

    const items = this.restockedItems
      .filter((r) => (this.printCopies.get(r.variantId) || 0) > 0)
      .map((r) => ({
        sku: r.sku,
        productName: this.product!.name,
        variantLabel: [r.size, r.color].filter(Boolean).join(' / '),
        price: Number(this.product!.basePrice),
        lotCode: this.lotCode.trim() || undefined,
        copies: this.printCopies.get(r.variantId) || 1,
      }));

    if (items.length === 0) {
      this.notification.warning('No labels to print — all quantities are 0');
      return;
    }
    this.printing = true;

    this.api.post<any>('/printing/print', { items })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.printing = false;
          this.notification.success(
            `Printed ${res.data?.labelsPrinted ?? items.length} label(s)`
          );
        },
        error: () => {
          this.printing = false;
          this.notification.error('Failed to print labels');
        },
      });
  }

  skipPrint(): void {
    this.router.navigate(['/inventory/products', this.productId]);
  }

  onCancel(): void {
    this.router.navigate(['/inventory/products', this.productId]);
  }

  formatCurrency(value: number | string): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(value));
  }
}
