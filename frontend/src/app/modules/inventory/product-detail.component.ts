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

/** One row in the "Add Variant" grid. */
interface VariantDraft {
  size: string;
  color: string;
  mrpOverride: number | null;
  priceOverride: number | null;
  costOverride: number | null;
  stock: number | null;
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

  // View filter — show only variants with on-hand stock > 0. Defaults ON so the
  // page reflects only in-stock articles (the header count, the totals, and the
  // table all follow this flag). Untick to see every variant.
  showInStockOnly = true;

  // Add-variant form — a multi-row grid. Each row becomes one new variant and
  // all rows are saved together via the bulk endpoint. Stock defaults to 1
  // (a freshly received article normally arrives with at least one piece).
  showAddVariant = false;
  newVariantRows: VariantDraft[] = [];
  savingVariant = false;

  // Existing color names (from the /colors master) for the color dropdown.
  // Free text is still allowed — a new name creates a new color on save.
  existingColors: string[] = [];

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
    this.loadColors();
  }

  private loadColors(): void {
    this.api
      .get<ApiResponse<{ id: number; name: string }[]>>('/colors')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.existingColors = (res.data || []).map((c) => c.name).filter(Boolean);
        },
        error: () => {
          this.existingColors = []; // dropdown just falls back to free text
        },
      });
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

  /** Variants reflected in the view — optionally filtered to in-stock only.
   *  Drives the header count, the totals cards, and the variants table so they
   *  all stay consistent with the in-stock-only toggle. */
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

  /** Totals across the currently displayed variants — a plain sum of each
   *  variant's effective price (one per variant, NOT stock-weighted). Respects
   *  the in-stock-only filter so the sums match the count and the table. MRP
   *  skips variants with no MRP recorded. */
  get variantTotals(): { cost: number; landing: number; mrp: number; sale: number } {
    const variants = this.displayedVariants;
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

  private blankVariantRow(): VariantDraft {
    return { size: '', color: '', mrpOverride: null, priceOverride: null, costOverride: null, stock: 1 };
  }

  toggleAddVariant(): void {
    this.showAddVariant = !this.showAddVariant;
    // Start with a single blank row every time the form is opened.
    this.newVariantRows = this.showAddVariant ? [this.blankVariantRow()] : [];
  }

  addVariantRow(): void {
    this.newVariantRows.push(this.blankVariantRow());
  }

  removeVariantRow(index: number): void {
    this.newVariantRows.splice(index, 1);
    // Never leave the grid empty — keep one blank row to type into.
    if (this.newVariantRows.length === 0) this.newVariantRows.push(this.blankVariantRow());
  }

  /** A row counts once it has BOTH a size and a color. */
  private isRowComplete(r: VariantDraft): boolean {
    return !!r.size.trim() && !!r.color.trim();
  }

  /** A row the user started but left half-filled (only size OR only color). */
  private isRowPartial(r: VariantDraft): boolean {
    const hasSize = !!r.size.trim();
    const hasColor = !!r.color.trim();
    return (hasSize || hasColor) && !(hasSize && hasColor);
  }

  get canSaveVariant(): boolean {
    return this.newVariantRows.some((r) => this.isRowComplete(r));
  }

  saveVariant(): void {
    if (this.savingVariant || !this.product) return;

    // Block save while any started row is missing its size or color.
    if (this.newVariantRows.some((r) => this.isRowPartial(r))) {
      this.notify.error('Each row needs both a size and a color');
      return;
    }

    const rows = this.newVariantRows.filter((r) => this.isRowComplete(r));
    if (rows.length === 0) return;

    this.savingVariant = true;

    const variants = rows.map((r) => {
      const v: any = { size: r.size.trim(), color: r.color.trim() };
      if (r.mrpOverride) v.mrpOverride = Number(r.mrpOverride);
      if (r.priceOverride) v.priceOverride = Number(r.priceOverride);
      if (r.costOverride) v.costOverride = Number(r.costOverride);
      if (r.stock != null && Number(r.stock) > 0) v.initialStock = Math.floor(Number(r.stock));
      return v;
    });

    // Bulk endpoint = create new (size,color) combos + top up any that already
    // exist. SKUs and barcodes are auto-generated; stock lands in the current branch.
    this.api
      .post<ApiResponse<any>>(`/products/${this.product.id}/variants/bulk`, { variants })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const created = res.data?.created?.length ?? 0;
          const incremented = res.data?.incremented?.length ?? 0;
          const skipped = res.data?.skipped?.length ?? 0;
          const parts: string[] = [];
          if (created) parts.push(`${created} added`);
          if (incremented) parts.push(`${incremented} restocked`);
          if (skipped) parts.push(`${skipped} skipped`);
          this.notify.success(parts.length ? `Variants: ${parts.join(' · ')}` : 'No changes');
          this.savingVariant = false;
          this.showAddVariant = false;
          this.newVariantRows = [];
          this.loadProduct(String(this.product!.id));
        },
        error: (err: any) => {
          this.savingVariant = false;
          this.notify.error(err?.error?.error || err?.error?.message || 'Failed to add variants');
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
