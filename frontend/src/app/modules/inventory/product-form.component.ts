import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  Subject,
  forkJoin,
  takeUntil,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  of,
} from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { LabelPrintService } from '../../shared/label-print.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { BulkVariantGeneratorComponent } from './bulk-variant-generator.component';
import { VendorPickerComponent } from '../vendors/vendor-picker.component';
import { AutoCapsDirective } from '../../shared/directives/auto-caps.directive';

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
    AutoCapsDirective,
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
  mrp: number | null = null;
  basePrice: number | null = null;
  costPrice: number | null = null;
  landingPrice: number | null = null;
  /** §13.1 — profit margin % over cost; two-way with Sale Price. */
  marginPercent: number | null = null;

  /** §13.3 — Sale Price = MRP − 10%, rounded to whole rupees (odd values OK). */
  onMrpChange(): void {
    if (this.mrp != null && this.mrp > 0) {
      this.basePrice = Math.round(this.mrp * 0.9);
      this.recomputeMargin();
    }
  }

  /** §13.1 — entering a margin % sets the Sale Price from cost. */
  onMarginChange(): void {
    if (this.costPrice != null && this.costPrice > 0 && this.marginPercent != null) {
      this.basePrice = Math.round(this.costPrice * (1 + this.marginPercent / 100));
    }
  }

  /** §13.1 — keep the displayed margin % in sync when price/cost change directly. */
  recomputeMargin(): void {
    if (this.costPrice != null && this.costPrice > 0 && this.basePrice != null) {
      this.marginPercent = Math.round(((this.basePrice - this.costPrice) / this.costPrice) * 100);
    }
  }
  description = '';
  vendorId: number | null = null;
  lotCode = '';
  // GST per Indian retail rules: HSN + CGST + SGST. Default 9+9 = 18%.
  hsnCode = '';
  cgstRate: number | null = 9;
  sgstRate: number | null = 9;
  priceIncludesTax = true;
  // Return policy flags (e.g. clearance/sale/defective goods).
  nonReturnable = false;
  exchangeOnly = false;

  // Vendor payment terms — used when the user adds stock from the edit
  // page (or from initial creation with a vendor + lot).
  paymentMode: 'cash' | 'credit' = 'cash';
  dueDate = '';

  // Post-creation print flow
  createdProduct: any = null;
  printCopies: Map<number, number> = new Map();
  printing = false;

  // Manual variant rows (create mode only)
  variants: {
    size: string;
    color: string;
    mrp: number | null;
    priceOverride: number | null;
    costOverride: number | null;
  }[] = [];

  // Variants emitted by the bulk generator (preview, not yet persisted)
  bulkGeneratedVariants: Array<{
    size: string;
    color: string;
    mrpOverride?: number;
    priceOverride?: number;
    sku?: string;
    initialStock?: number;
  }> = [];

  // Existing-product suggestions (create mode only) — surface dupes early
  // so the cashier doesn't accidentally make a second "Black Kurti" record.
  private nameSearch$ = new Subject<string>();
  nameSuggestions: { id: number; name: string; brand?: { name: string } }[] = [];
  showNameSuggestions = false;

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
    private router: Router,
    private labelPrint: LabelPrintService
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

    // Wire the name typeahead. Only meaningful in create mode — in edit
    // mode the user is confirming an existing product, not searching.
    if (!this.isEdit) {
      this.nameSearch$
        .pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((q) => {
            const trimmed = q.trim();
            if (trimmed.length < 2) return of({ data: [] as any[] });
            return this.api.get<any>('/products', { search: trimmed, limit: '5' });
          }),
          takeUntil(this.destroy$)
        )
        .subscribe({
          next: (res: any) => {
            this.nameSuggestions = res?.data ?? [];
            this.showNameSuggestions = this.nameSuggestions.length > 0;
          },
        });
    }
  }

  onNameInput(): void {
    if (this.isEdit) return;
    this.nameSearch$.next(this.name);
  }

  pickExistingProduct(p: { id: number }): void {
    this.showNameSuggestions = false;
    // Take them to the existing product's edit page rather than creating
    // a duplicate. The cashier can still cancel out and force-create if
    // it really is a different product.
    this.router.navigate(['/inventory/products', p.id, 'edit']);
  }

  hideNameSuggestions(): void {
    // setTimeout so click handlers on suggestions still fire before the
    // dropdown blurs away.
    setTimeout(() => (this.showNameSuggestions = false), 150);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private prefillFromProduct(p: any): void {
    this.name = p.name || '';
    this.brandId = p.brand?.id || p.brandId || null;
    this.categoryId = p.category?.id || p.categoryId || null;
    this.mrp = (p as any).mrp ?? null;
    this.basePrice = p.basePrice ?? null;
    this.costPrice = p.costPrice ?? null;
    this.landingPrice = p.landingPrice ?? null;
    this.description = p.description || '';
    this.hsnCode = p.hsnCode || '';
    this.cgstRate = p.cgstRate !== undefined && p.cgstRate !== null ? Number(p.cgstRate) : 9;
    this.sgstRate = p.sgstRate !== undefined && p.sgstRate !== null ? Number(p.sgstRate) : 9;
    this.priceIncludesTax = p.priceIncludesTax !== false;
    this.nonReturnable = p.nonReturnable === true;
    this.exchangeOnly = p.exchangeOnly === true;
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
      mrp: null,
      priceOverride: null,
      costOverride: null,
    });
  }

  removeVariantRow(index: number): void {
    this.variants.splice(index, 1);
  }

  /** Editing a manual row's MRP auto-fills its Sale Price to MRP − 10% (rounded). */
  onVariantMrpChange(row: { mrp: number | null; priceOverride: number | null }, value: number): void {
    const mrp = value != null && value > 0 ? Number(value) : null;
    row.mrp = mrp;
    if (mrp != null) row.priceOverride = Math.round(mrp * 0.9);
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
      mrpOverride?: number;
      priceOverride?: number;
      sku?: string;
      initialStock?: number;
    }>
  ): void {
    this.bulkGeneratedVariants = variants;
  }

  // ─── Submit / Cancel ────────────────────────────────────────────
  /**
   * Collect manual + bulk variant rows, dedup by (size, color) with
   * manual winning, and stamp the per-variant cost from the form's
   * costPrice unless the row supplied its own override.
   */
  private collectVariantsForSubmit(): any[] {
    const fallbackUnitCost = this.costPrice ? Number(this.costPrice) : null;
    const manual = this.variants
      .filter((v) => v.size.trim() && v.color.trim())
      .map((v) => ({
        size: v.size.trim(),
        color: v.color.trim(),
        ...(v.mrp ? { mrpOverride: Number(v.mrp) } : {}),
        ...(v.priceOverride ? { priceOverride: Number(v.priceOverride) } : {}),
        ...(v.costOverride ? { costOverride: Number(v.costOverride) } : {}),
        ...(v.costOverride
          ? { unitCost: Number(v.costOverride) }
          : fallbackUnitCost !== null
          ? { unitCost: fallbackUnitCost }
          : {}),
      }));

    const seen = new Set(
      manual.map((v) => `${v.size.toLowerCase()}|${v.color.toLowerCase()}`)
    );
    const bulk = (this.bulkGeneratedVariants || [])
      .filter((v) => {
        const key = `${v.size.toLowerCase()}|${(v.color || '').toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((v) => ({
        ...v,
        unitCost:
          v.priceOverride && fallbackUnitCost === null
            ? null
            : fallbackUnitCost,
      }));

    return [...manual, ...bulk];
  }

  onSubmit(): void {
    if (!this.isValid || this.saving) return;
    this.saving = true;

    const productPayload: Record<string, any> = {
      name: this.name.trim(),
      brandId: this.brandId,
      categoryId: this.categoryId,
      mrp: this.mrp != null ? Number(this.mrp) : undefined,
      basePrice: Number(this.basePrice),
      costPrice: Number(this.costPrice),
      landingPrice: this.landingPrice ? Number(this.landingPrice) : undefined,
      description: this.description.trim() || undefined,
      hsnCode: this.hsnCode.trim() || null,
      cgstRate: this.cgstRate !== null ? Number(this.cgstRate) : 0,
      sgstRate: this.sgstRate !== null ? Number(this.sgstRate) : 0,
      priceIncludesTax: this.priceIncludesTax,
      nonReturnable: this.nonReturnable,
      exchangeOnly: this.exchangeOnly,
    };

    const variants = this.collectVariantsForSubmit();
    const supplierMeta = {
      vendorId: this.vendorId || undefined,
      lotCode: this.lotCode.trim() || undefined,
      paymentMode: this.paymentMode,
      dueDate:
        this.paymentMode === 'credit' && this.dueDate ? this.dueDate : undefined,
    };

    if (!this.isEdit) {
      // Create flow: variants are nested into the product create payload.
      if (variants.length > 0) productPayload['variants'] = variants;
      productPayload['vendorId'] = supplierMeta.vendorId;
      productPayload['lotCode'] = supplierMeta.lotCode;

      this.api
        .post('/products', productPayload)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res: any) => {
            this.saving = false;
            this.createdProduct = res.data;
            for (const v of (this.createdProduct.variants || [])) {
              const bulkMatch = this.bulkGeneratedVariants.find(
                (bv) =>
                  bv.size?.toLowerCase() === v.size?.toLowerCase() &&
                  (bv.color || '').toLowerCase() === (v.color || '').toLowerCase()
              );
              this.printCopies.set(v.id, bulkMatch?.initialStock || 1);
            }
            this.notification.success('Product created');
          },
          error: () => {
            this.saving = false;
            this.notification.error('Failed to create product');
          },
        });
      return;
    }

    // Edit flow: PUT the product fields, then if there are any variant
    // rows entered, POST them to the bulk endpoint which now both
    // creates new size+color combos AND tops up stock on existing ones.
    this.api
      .put(`/products/${this.productId}`, productPayload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (variants.length === 0) {
            this.saving = false;
            this.notification.success('Product updated');
            this.router.navigate(['/inventory/products']);
            return;
          }

          const bulkBody: any = {
            variants,
            ...supplierMeta,
          };
          this.api
            .post<any>(`/products/${this.productId}/variants/bulk`, bulkBody)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (bulkRes: any) => {
                this.saving = false;
                const created = bulkRes.data?.created?.length || 0;
                const incremented = bulkRes.data?.incremented?.length || 0;
                const parts: string[] = ['Product updated'];
                if (created) parts.push(`${created} new variant(s)`);
                if (incremented) parts.push(`${incremented} restocked`);
                this.notification.success(parts.join(' · '));
                this.router.navigate(['/inventory/products']);
              },
              error: () => {
                this.saving = false;
                this.notification.error(
                  'Product saved but failed to add variants — try again.'
                );
              },
            });
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

    this.labelPrint.print(items)
      .then((data) => {
        this.printing = false;
        this.notification.success(
          `Printed ${data.labelsPrinted ?? items.length} label(s)`
        );
      })
      .catch((err: any) => {
        this.printing = false;
        this.notification.error(err?.message || 'Failed to print labels');
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
