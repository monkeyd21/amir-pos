import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { BulkVariantGeneratorComponent } from './bulk-variant-generator.component';
import { VendorPickerComponent } from '../vendors/vendor-picker.component';

interface Brand {
  id: number;
  name: string;
}

interface Category {
  id: number;
  name: string;
}

interface Color {
  id: number;
  name: string;
  hex?: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * Full-page product create/edit form.
 *
 * This used to be a modal dialog but was converted to a page because the
 * form got too tall for a popup (name, brand, category, pricing, a bulk
 * variant generator, manual variant rows, description…). The popup felt
 * cluttered and the variant generator never had breathing room.
 *
 * The component handles both "Add" (no `:id`) and "Edit" (`:id` present)
 * from a single route. On create mode it also wires up inline brand/
 * category creation so the cashier doesn't have to leave the form to set
 * up a new taxonomy entry.
 */
@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    PageHeaderComponent,
    BulkVariantGeneratorComponent,
    VendorPickerComponent,
  ],
  templateUrl: './product-form.component.html',
})
export class ProductFormComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  productId: number | null = null;
  isEdit = false;
  loading = true;
  saving = false;

  brands: Brand[] = [];
  categories: Category[] = [];
  colors: Color[] = [];

  // Core form fields
  name = '';
  brandId: number | null = null;
  categoryId: number | null = null;
  basePrice: number | null = null;
  costPrice: number | null = null;
  landingPrice: number | null = null;
  description = '';
  vendorId: number | null = null;
  lotCode = '';

  // Post-creation print flow
  createdProduct: any = null;
  printCopies: Map<number, number> = new Map();
  printing = false;

  // Manual variant rows (create mode only)
  variants: {
    size: string;
    color: string;
    priceOverride: number | null;
    costOverride: number | null;
  }[] = [];

  // Variants emitted by the bulk generator (preview, not yet persisted)
  bulkGeneratedVariants: Array<{
    size: string;
    color: string;
    priceOverride?: number;
    sku?: string;
    initialStock?: number;
  }> = [];

  // Inline add-brand
  addingBrand = false;
  newBrandName = '';
  savingBrand = false;

  // Inline add-category
  addingCategory = false;
  newCategoryName = '';
  savingCategory = false;

  // Inline add-color (for manual variant row pickers *and* the bulk generator)
  addingColor = false;
  newColorName = '';
  newColorHex = '';
  savingColor = false;
  /** Tracks which manual-variant row triggered the "add color" panel so
   *  we can auto-assign the newly created color to that row. `null` means
   *  it was triggered from the bulk generator. */
  colorTargetRowIndex: number | null = null;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.productId = idParam ? Number(idParam) : null;
    this.isEdit = this.productId !== null;

    // Always load taxonomy (brands + categories + colors). On edit we
    // also need the existing product to pre-fill the form.
    const requests: Record<string, any> = {
      brands: this.api.get<ApiResponse<Brand[]>>('/brands'),
      categories: this.api.get<ApiResponse<Category[]>>('/categories'),
      colors: this.api.get<ApiResponse<Color[]>>('/colors'),
    };
    if (this.isEdit) {
      requests['product'] = this.api.get<ApiResponse<any>>(
        `/products/${this.productId}`
      );
    }

    forkJoin(requests)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.brands = res.brands.data ?? [];
          this.categories = res.categories.data ?? [];
          this.colors = res.colors.data ?? [];
          if (this.isEdit && res.product?.data) {
            this.prefillFromProduct(res.product.data);
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load form data');
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private prefillFromProduct(p: any): void {
    this.name = p.name || '';
    this.brandId = p.brand?.id || p.brandId || null;
    this.categoryId = p.category?.id || p.categoryId || null;
    this.basePrice = p.basePrice ?? null;
    this.costPrice = p.costPrice ?? null;
    this.landingPrice = p.landingPrice ?? null;
    this.description = p.description || '';
  }

  get isValid(): boolean {
    return (
      !!this.name.trim() &&
      this.brandId !== null &&
      this.categoryId !== null &&
      this.basePrice !== null &&
      this.basePrice > 0 &&
      this.costPrice !== null &&
      this.costPrice > 0
    );
  }

  get selectedBrandName(): string {
    return this.brands.find((b) => b.id === this.brandId)?.name || '';
  }

  // ─── Inline brand creation ──────────────────────────────────────
  showAddBrand(): void {
    this.addingBrand = true;
    this.newBrandName = '';
  }

  cancelAddBrand(): void {
    this.addingBrand = false;
    this.newBrandName = '';
  }

  saveNewBrand(): void {
    if (!this.newBrandName.trim() || this.savingBrand) return;
    this.savingBrand = true;
    this.api
      .post<any>('/brands', { name: this.newBrandName.trim() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const brand = res.data;
          this.brands.push({ id: brand.id, name: brand.name });
          this.brandId = brand.id;
          this.addingBrand = false;
          this.newBrandName = '';
          this.savingBrand = false;
          this.notification.success(`Brand "${brand.name}" created`);
        },
        error: () => {
          this.savingBrand = false;
          this.notification.error('Failed to create brand');
        },
      });
  }

  // ─── Inline category creation ───────────────────────────────────
  showAddCategory(): void {
    this.addingCategory = true;
    this.newCategoryName = '';
  }

  cancelAddCategory(): void {
    this.addingCategory = false;
    this.newCategoryName = '';
  }

  saveNewCategory(): void {
    if (!this.newCategoryName.trim() || this.savingCategory) return;
    this.savingCategory = true;
    this.api
      .post<any>('/categories', { name: this.newCategoryName.trim() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const cat = res.data;
          this.categories.push({ id: cat.id, name: cat.name });
          this.categoryId = cat.id;
          this.addingCategory = false;
          this.newCategoryName = '';
          this.savingCategory = false;
          this.notification.success(`Category "${cat.name}" created`);
        },
        error: () => {
          this.savingCategory = false;
          this.notification.error('Failed to create category');
        },
      });
  }

  // ─── Inline color creation ──────────────────────────────────────
  //
  // Triggered from either a manual variant row (pass the row index) or
  // the bulk generator (pass `null`). On save we refresh `colors` so both
  // pickers get the new option, and optionally auto-select it for the
  // originating row.
  showAddColor(targetRowIndex: number | null = null): void {
    this.addingColor = true;
    this.newColorName = '';
    this.newColorHex = '';
    this.colorTargetRowIndex = targetRowIndex;
  }

  cancelAddColor(): void {
    this.addingColor = false;
    this.newColorName = '';
    this.newColorHex = '';
    this.colorTargetRowIndex = null;
  }

  saveNewColor(): void {
    const name = this.newColorName.trim();
    if (!name || this.savingColor) return;
    this.savingColor = true;

    const payload: Record<string, string> = { name };
    const hex = this.newColorHex.trim();
    if (hex) {
      // Normalize to #RRGGBB so the swatch renders predictably.
      payload['hex'] = hex.startsWith('#') ? hex : `#${hex}`;
    }

    this.api
      .post<ApiResponse<Color>>('/colors', payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const color = res.data;
          // Splice in alphabetically so the picker stays sorted.
          const idx = this.colors.findIndex(
            (c) => c.name.toLowerCase() > color.name.toLowerCase()
          );
          if (idx === -1) this.colors.push(color);
          else this.colors.splice(idx, 0, color);
          // Immutable re-assignment so the child `bulk-variant-generator`
          // sees the reference change and re-renders its swatch list.
          this.colors = [...this.colors];

          // If the request came from a manual-variant row, pre-select
          // the new color on that row so the cashier doesn't have to
          // re-open the dropdown.
          if (
            this.colorTargetRowIndex !== null &&
            this.variants[this.colorTargetRowIndex]
          ) {
            this.variants[this.colorTargetRowIndex].color = color.name;
          }

          this.notification.success(`Color "${color.name}" created`);
          this.cancelAddColor();
          this.savingColor = false;
        },
        error: (err) => {
          this.savingColor = false;
          this.notification.error(
            err.error?.error || 'Failed to create color'
          );
        },
      });
  }

  // ─── Variant rows ───────────────────────────────────────────────
  addVariantRow(): void {
    this.variants.push({
      size: '',
      color: '',
      priceOverride: null,
      costOverride: null,
    });
  }

  removeVariantRow(index: number): void {
    this.variants.splice(index, 1);
  }

  onColorCreated(color: Color): void {
    // Insert alphabetically so the picker stays sorted
    const idx = this.colors.findIndex(
      (c) => c.name.toLowerCase() > color.name.toLowerCase()
    );
    if (idx === -1) this.colors.push(color);
    else this.colors.splice(idx, 0, color);
    // Immutable re-assignment so child sees the change
    this.colors = [...this.colors];
  }

  onBulkPreviewChange(
    variants: Array<{
      size: string;
      color: string;
      priceOverride?: number;
      sku?: string;
      initialStock?: number;
    }>
  ): void {
    this.bulkGeneratedVariants = variants;
  }

  // ─── Submit / Cancel ────────────────────────────────────────────
  onSubmit(): void {
    if (!this.isValid || this.saving) return;
    this.saving = true;

    const payload: Record<string, any> = {
      name: this.name.trim(),
      brandId: this.brandId,
      categoryId: this.categoryId,
      basePrice: Number(this.basePrice),
      costPrice: Number(this.costPrice),
      landingPrice: this.landingPrice ? Number(this.landingPrice) : undefined,
      description: this.description.trim() || undefined,
      vendorId: this.vendorId || undefined,
      lotCode: this.lotCode.trim() || undefined,
    };

    if (!this.isEdit) {
      const manual = this.variants
        .filter((v) => v.size.trim() && v.color.trim())
        .map((v) => ({
          size: v.size.trim(),
          color: v.color.trim(),
          ...(v.priceOverride ? { priceOverride: Number(v.priceOverride) } : {}),
          ...(v.costOverride ? { costOverride: Number(v.costOverride) } : {}),
        }));

      // De-dupe bulk-generated rows against manual entries on
      // (size, color). Manual wins — cashier just typed those.
      const seen = new Set(
        manual.map((v) => `${v.size.toLowerCase()}|${v.color.toLowerCase()}`)
      );
      const bulk = (this.bulkGeneratedVariants || []).filter((v) => {
        const key = `${v.size.toLowerCase()}|${(v.color || '').toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const all = [...manual, ...bulk];
      if (all.length > 0) payload['variants'] = all;
    }

    const req = this.isEdit
      ? this.api.put(`/products/${this.productId}`, payload)
      : this.api.post('/products', payload);

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res: any) => {
        this.saving = false;
        if (this.isEdit) {
          this.notification.success('Product updated');
          this.router.navigate(['/inventory/products']);
        } else {
          this.createdProduct = res.data;
          // Default print copies to initial stock or 1
          for (const v of (this.createdProduct.variants || [])) {
            const bulkMatch = this.bulkGeneratedVariants.find(
              (bv) => bv.size?.toLowerCase() === v.size?.toLowerCase() &&
                      (bv.color || '').toLowerCase() === (v.color || '').toLowerCase()
            );
            this.printCopies.set(v.id, bulkMatch?.initialStock || 1);
          }
          this.notification.success('Product created');
        }
      },
      error: () => {
        this.saving = false;
        this.notification.error('Failed to save product');
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
    if (!this.createdProduct?.variants?.length || this.printing) return;

    const items = this.createdProduct.variants
      .filter((v: any) => (this.printCopies.get(v.id) || 0) > 0)
      .map((v: any) => ({
        sku: v.sku,
        productName: this.createdProduct.name,
        variantLabel: [v.size, v.color].filter(Boolean).join(' / '),
        price: Number(v.priceOverride || this.createdProduct.basePrice || 0),
        lotCode: this.lotCode.trim() || undefined,
        copies: this.printCopies.get(v.id) || 1,
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
    this.router.navigate(['/inventory/products']);
  }

  goToProduct(): void {
    if (this.createdProduct?.id) {
      this.router.navigate(['/inventory/products', this.createdProduct.id]);
    } else {
      this.router.navigate(['/inventory/products']);
    }
  }

  onCancel(): void {
    this.router.navigate(['/inventory/products']);
  }
}
