import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { DialogService } from '../../shared/dialog/dialog.service';
import { StockAdjustmentDialogComponent } from './stock-adjustment-dialog.component';
import { BranchService } from '../../core/services/branch.service';
import { AuthService } from '../../core/services/auth.service';
import { BulkVariantGeneratorComponent } from './bulk-variant-generator.component';

interface Variant {
  id: number;
  sku: string;
  size?: string;
  color?: string;
  barcode?: string;
  priceOverride: number | null;
  mrpOverride: number | null;
  costOverride: number | null;
  landingOverride: number | null;
  isActive: boolean;
  inventory?: { quantity: number; branchId: number }[];
}

interface Product {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  basePrice: number;
  mrp?: number | null;
  costPrice?: number;
  landingPrice?: number | null;
  taxRate?: number;
  isActive: boolean;
  brand?: { id: number; name: string };
  category?: { id: number; name: string };
  variants: Variant[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, LoadingSpinnerComponent, BulkVariantGeneratorComponent],
  styles: [`:host { display: block; }`],
  templateUrl: './product-detail.component.html',
})
export class ProductDetailComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  product: Product | null = null;
  loading = true;

  // Variants table filter — show only variants with on-hand stock > 0.
  showInStockOnly = false;

  // Add variant form
  showAddVariant = false;
  newVariant = { size: '', color: '', priceOverride: null as number | null, costOverride: null as number | null };
  savingVariant = false;

  // Only owner/manager may override prices (matches the backend authz on
  // PUT /products/:id/variants/:variantId).
  canEditPrices = false;

  // Inline per-variant price override editor
  editingVariantId: number | null = null;
  editValues = { mrpOverride: null as number | null, priceOverride: null as number | null };
  savingEdit = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notify: NotificationService,
    private dialog: DialogService,
    private branchService: BranchService,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    this.canEditPrices = this.auth.hasRole(['owner', 'manager']);
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadProduct(id);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadProduct(id: string): void {
    this.loading = true;
    this.api
      .get<ApiResponse<Product>>(`/products/${id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.product = res.data;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load product');
          this.router.navigate(['/inventory/products']);
        },
      });
  }

  /** Variants shown in the table — optionally filtered to in-stock only. */
  get displayedVariants(): Variant[] {
    const variants = this.product?.variants ?? [];
    return this.showInStockOnly ? variants.filter((v) => this.getStock(v) > 0) : variants;
  }

  getStock(variant: Variant): number {
    if (!variant.inventory || variant.inventory.length === 0) return 0;
    return variant.inventory.reduce((sum, inv) => sum + (inv.quantity || 0), 0);
  }

  getEffectivePrice(variant: Variant): number {
    return Number(variant.priceOverride ?? this.product?.basePrice ?? 0);
  }

  /** §13.3 — the list price (MRP): per-variant override, else the product MRP.
   *  Returns null when the product has no MRP recorded (renders as a dash). */
  getEffectiveMrp(variant: Variant): number | null {
    const raw = variant.mrpOverride ?? this.product?.mrp ?? null;
    return raw != null ? Number(raw) : null;
  }

  /** Effective cost (purchase) price: per-variant override, else product cost. */
  getEffectiveCost(variant: Variant): number {
    return Number(variant.costOverride ?? this.product?.costPrice ?? 0);
  }

  /** Effective landing cost: per-variant override, else the product landing
   *  price, falling back to the cost price (mirrors the P&L fallback chain). */
  getEffectiveLanding(variant: Variant): number {
    return Number(
      variant.landingOverride ?? this.product?.landingPrice ?? this.getEffectiveCost(variant)
    );
  }

  /** Totals across every variant — a plain sum of each variant's effective
   *  price (one per variant, NOT stock-weighted). MRP skips variants with no
   *  MRP recorded. */
  get variantTotals(): { cost: number; landing: number; mrp: number; sale: number } {
    const variants = this.product?.variants ?? [];
    return variants.reduce(
      (acc, v) => {
        acc.cost += this.getEffectiveCost(v);
        acc.landing += this.getEffectiveLanding(v);
        acc.mrp += this.getEffectiveMrp(v) ?? 0;
        acc.sale += this.getEffectivePrice(v);
        return acc;
      },
      { cost: 0, landing: 0, mrp: 0, sale: 0 }
    );
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  adjustStock(variant: Variant): void {
    const currentBranch = this.branchService.getCurrentBranch();
    const branchId = currentBranch ? Number(currentBranch.id) : 1;

    const ref = this.dialog.open(StockAdjustmentDialogComponent, {
      data: {
        inventoryItem: {
          variantId: variant.id,
          branchId,
          variant: {
            ...variant,
            product: { name: this.product?.name },
          },
          quantity: this.getStock(variant),
        },
      },
      width: '480px',
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.loadProduct(String(this.product!.id));
    });
  }

  /** Open the inline editor for a variant's MRP / Sale Price overrides.
   *  Pre-fills with the current per-variant overrides (null = "inherit from
   *  product", shown as an empty input). */
  startEditPrice(variant: Variant): void {
    this.editingVariantId = variant.id;
    this.editValues = {
      mrpOverride: variant.mrpOverride != null ? Number(variant.mrpOverride) : null,
      priceOverride: variant.priceOverride != null ? Number(variant.priceOverride) : null,
    };
  }

  cancelEditPrice(): void {
    this.editingVariantId = null;
    this.savingEdit = false;
  }

  /** Persist the overrides. An empty field clears the override (sends null) so
   *  the variant falls back to the product-level MRP / base price. */
  saveEditPrice(variant: Variant): void {
    if (this.savingEdit || !this.product) return;
    this.savingEdit = true;

    const toNumOrNull = (v: number | null): number | null =>
      v === null || (v as unknown as string) === '' ? null : Number(v);

    const body = {
      mrpOverride: toNumOrNull(this.editValues.mrpOverride),
      priceOverride: toNumOrNull(this.editValues.priceOverride),
    };

    this.api
      .put<ApiResponse<any>>(`/products/${this.product.id}/variants/${variant.id}`, body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notify.success('Prices updated');
          this.editingVariantId = null;
          this.savingEdit = false;
          this.loadProduct(String(this.product!.id));
        },
        error: (err) => {
          this.savingEdit = false;
          this.notify.error(err?.error?.error || 'Failed to update prices');
        },
      });
  }

  toggleAddVariant(): void {
    this.showAddVariant = !this.showAddVariant;
    this.newVariant = { size: '', color: '', priceOverride: null, costOverride: null };
  }

  get canSaveVariant(): boolean {
    return !!this.newVariant.size.trim() && !!this.newVariant.color.trim();
  }

  saveVariant(): void {
    if (!this.canSaveVariant || this.savingVariant || !this.product) return;
    this.savingVariant = true;

    const body: any = {
      size: this.newVariant.size.trim(),
      color: this.newVariant.color.trim(),
    };
    if (this.newVariant.priceOverride) body.priceOverride = Number(this.newVariant.priceOverride);
    if (this.newVariant.costOverride) body.costOverride = Number(this.newVariant.costOverride);

    this.api
      .post<ApiResponse<any>>(`/products/${this.product.id}/variants`, body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notify.success('Variant added');
          this.savingVariant = false;
          this.showAddVariant = false;
          this.loadProduct(String(this.product!.id));
        },
        error: () => {
          this.savingVariant = false;
          this.notify.error('Failed to add variant');
        },
      });
  }

  onBulkGenerated(): void {
    if (this.product) {
      this.loadProduct(String(this.product.id));
    }
  }

  goBack(): void {
    this.router.navigate(['/inventory/products']);
  }
}
