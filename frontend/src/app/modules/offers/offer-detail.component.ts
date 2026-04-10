import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import {
  Offer,
  OfferDetail,
  OfferType,
  ApiResponse,
  OFFER_TYPE_LABELS,
} from './offer.types';

interface Variant {
  id: number;
  sku: string;
  size: string;
  color: string;
}

interface Product {
  id: number;
  name: string;
  brand?: { id: number; name: string };
  category?: { id: number; name: string };
  variants: Variant[];
}

interface PagedResponse<T> {
  success: boolean;
  data: T[];
  meta?: { page: number; totalPages: number; total: number };
}

type SaveState = 'idle' | 'saving';

@Component({
  selector: 'app-offer-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './offer-detail.component.html',
})
export class OfferDetailComponent implements OnInit {
  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

  // ─── Form state ──────────────────────────────────────────
  offerId: number | null = null;
  isNew = true;
  loading = false;
  saveState: SaveState = 'idle';

  form: {
    name: string;
    description: string;
    type: OfferType;
    percentValue: number | null;
    flatValue: number | null;
    buyQty: number | null;
    getQty: number | null;
    priority: number;
    isActive: boolean;
    startsAt: string;
    endsAt: string;
  } = {
    name: '',
    description: '',
    type: 'percentage',
    percentValue: 10,
    flatValue: null,
    buyQty: null,
    getQty: null,
    priority: 0,
    isActive: true,
    startsAt: '',
    endsAt: '',
  };

  readonly typeOptions: Array<{ value: OfferType; label: string }> = [
    { value: 'percentage', label: 'Percentage Off (e.g. 20% off)' },
    { value: 'flat', label: 'Flat Rs. Off (e.g. Rs. 500 off per unit)' },
    { value: 'buy_x_get_y_free', label: 'Buy X Get Y Free (BOGO)' },
    { value: 'buy_x_get_y_percent', label: 'Buy X Get Y% Off the whole line' },
    { value: 'bundle', label: 'Bundle: X units for fixed total' },
  ];

  // ─── Assignment state ────────────────────────────────────
  /** Variant-level source of truth — a variant is "in the offer" iff its id is in this set */
  selectedVariantIds = new Set<number>();

  products: Product[] = [];
  loadingProducts = false;
  productSearch = '';
  brandFilter: number | '' = '';
  categoryFilter: number | '' = '';
  expandedProductIds = new Set<number>();

  brands: Array<{ id: number; name: string }> = [];
  categories: Array<{ id: number; name: string }> = [];

  // Pagination for the product list
  page = 1;
  totalPages = 1;
  readonly pageSize = 20;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.isNew = !idParam;
    this.offerId = idParam ? parseInt(idParam, 10) : null;

    // Load filter dropdowns in parallel
    this.loadBrands();
    this.loadCategories();

    if (this.offerId) {
      this.loadOffer(this.offerId);
    } else {
      this.loadProducts();
    }

    // Debounced product search
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadProducts();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── Data loading ────────────────────────────────────────

  loadBrands(): void {
    this.api.get<ApiResponse<any[]>>('/brands').subscribe({
      next: (res) => (this.brands = (res.data ?? []).map((b) => ({ id: b.id, name: b.name }))),
    });
  }

  loadCategories(): void {
    this.api.get<ApiResponse<any[]>>('/categories').subscribe({
      next: (res) => (this.categories = (res.data ?? []).map((c) => ({ id: c.id, name: c.name }))),
    });
  }

  loadOffer(id: number): void {
    this.loading = true;
    this.api.get<ApiResponse<OfferDetail>>(`/offers/${id}`).subscribe({
      next: (res) => {
        const o = res.data;
        this.form = {
          name: o.name,
          description: o.description ?? '',
          type: o.type,
          percentValue: o.percentValue != null ? Number(o.percentValue) : null,
          flatValue: o.flatValue != null ? Number(o.flatValue) : null,
          buyQty: o.buyQty ?? null,
          getQty: o.getQty ?? null,
          priority: o.priority ?? 0,
          isActive: o.isActive,
          startsAt: o.startsAt ? o.startsAt.slice(0, 16) : '',
          endsAt: o.endsAt ? o.endsAt.slice(0, 16) : '',
        };

        // Seed selection from OfferProduct (expand to all variants) + OfferVariant
        this.selectedVariantIds = new Set<number>();
        for (const op of o.products) {
          for (const v of op.product.variants) {
            this.selectedVariantIds.add(v.id);
          }
        }
        for (const ov of o.variants) {
          this.selectedVariantIds.add(ov.variantId);
        }

        this.loading = false;
        this.loadProducts();
      },
      error: () => {
        this.loading = false;
        this.notification.error('Failed to load offer');
      },
    });
  }

  loadProducts(): void {
    this.loadingProducts = true;
    const params: Record<string, string | number> = {
      page: this.page,
      limit: this.pageSize,
    };
    if (this.productSearch) params['search'] = this.productSearch;
    if (this.brandFilter) params['brandId'] = this.brandFilter;
    if (this.categoryFilter) params['categoryId'] = this.categoryFilter;

    this.api.get<PagedResponse<Product>>('/products', params).subscribe({
      next: (res) => {
        this.products = res.data ?? [];
        this.totalPages = res.meta?.totalPages ?? 1;
        this.loadingProducts = false;
      },
      error: () => {
        this.loadingProducts = false;
      },
    });
  }

  // ─── Search / filter handlers ────────────────────────────

  onSearchInput(value: string): void {
    this.productSearch = value;
    this.searchSubject.next(value);
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadProducts();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
    this.loadProducts();
  }

  // ─── Selection logic ─────────────────────────────────────

  isVariantSelected(variantId: number): boolean {
    return this.selectedVariantIds.has(variantId);
  }

  /** 'none' | 'partial' | 'full' */
  productSelectionState(product: Product): 'none' | 'partial' | 'full' {
    if (product.variants.length === 0) return 'none';
    let selected = 0;
    for (const v of product.variants) {
      if (this.selectedVariantIds.has(v.id)) selected++;
    }
    if (selected === 0) return 'none';
    if (selected === product.variants.length) return 'full';
    return 'partial';
  }

  toggleProduct(product: Product): void {
    const state = this.productSelectionState(product);
    if (state === 'full') {
      for (const v of product.variants) this.selectedVariantIds.delete(v.id);
    } else {
      for (const v of product.variants) this.selectedVariantIds.add(v.id);
    }
    // Force reference change so Angular change detection picks it up
    this.selectedVariantIds = new Set(this.selectedVariantIds);
  }

  toggleVariant(variantId: number): void {
    if (this.selectedVariantIds.has(variantId)) {
      this.selectedVariantIds.delete(variantId);
    } else {
      this.selectedVariantIds.add(variantId);
    }
    this.selectedVariantIds = new Set(this.selectedVariantIds);
  }

  toggleExpanded(product: Product): void {
    if (this.expandedProductIds.has(product.id)) {
      this.expandedProductIds.delete(product.id);
    } else {
      this.expandedProductIds.add(product.id);
    }
  }

  isExpanded(product: Product): boolean {
    return this.expandedProductIds.has(product.id);
  }

  /** Select every variant of every product in the current filtered view */
  selectAllFiltered(): void {
    for (const p of this.products) {
      for (const v of p.variants) this.selectedVariantIds.add(v.id);
    }
    this.selectedVariantIds = new Set(this.selectedVariantIds);
  }

  /** Deselect every variant of every product in the current filtered view */
  deselectAllFiltered(): void {
    for (const p of this.products) {
      for (const v of p.variants) this.selectedVariantIds.delete(v.id);
    }
    this.selectedVariantIds = new Set(this.selectedVariantIds);
  }

  clearAllAssignments(): void {
    if (!confirm('Clear all assignments for this offer?')) return;
    this.selectedVariantIds = new Set();
  }

  // ─── Summary derived state ───────────────────────────────

  get totalSelectedVariants(): number {
    return this.selectedVariantIds.size;
  }

  /** Group selected variants by product for the summary chips */
  get summaryChips(): Array<{
    productId: number;
    productName: string;
    selected: number;
    total: number;
    allSelected: boolean;
  }> {
    const byProduct = new Map<
      number,
      { productName: string; selected: number; total: number }
    >();
    for (const p of this.products) {
      const totalInP = p.variants.length;
      let selectedInP = 0;
      for (const v of p.variants) {
        if (this.selectedVariantIds.has(v.id)) selectedInP++;
      }
      if (selectedInP > 0) {
        byProduct.set(p.id, {
          productName: p.name,
          selected: selectedInP,
          total: totalInP,
        });
      }
    }
    return [...byProduct.entries()].map(([productId, v]) => ({
      productId,
      productName: v.productName,
      selected: v.selected,
      total: v.total,
      allSelected: v.selected === v.total,
    }));
  }

  // ─── Save ────────────────────────────────────────────────

  canSave(): boolean {
    if (!this.form.name.trim()) return false;
    switch (this.form.type) {
      case 'percentage':
        return (this.form.percentValue ?? 0) > 0;
      case 'flat':
        return (this.form.flatValue ?? 0) > 0;
      case 'buy_x_get_y_free':
        return (this.form.buyQty ?? 0) > 0 && (this.form.getQty ?? 0) > 0;
      case 'buy_x_get_y_percent':
        return (this.form.buyQty ?? 0) > 0 && (this.form.percentValue ?? 0) > 0;
      case 'bundle':
        return (this.form.buyQty ?? 0) > 0 && (this.form.flatValue ?? 0) > 0;
    }
  }

  /**
   * Build the assignment payload. For each product in `products`, if ALL its
   * variants are selected, we emit a product-level assignment. Otherwise we
   * emit individual variant-level assignments. Products not present in the
   * current page are handled via the variant set we've tracked.
   */
  private buildAssignmentPayload(): { productIds: number[]; variantIds: number[] } {
    // Group all variantIds we have in memory (across loaded pages) by productId.
    // We can only collapse to product-level when we KNOW the total variant count
    // of a product — which we only have for products we've loaded. For products
    // we haven't loaded this session, we just send the variants individually.
    const productTotalVariants = new Map<number, number>();
    const productSelectedVariantIds = new Map<number, number[]>();
    for (const p of this.products) {
      productTotalVariants.set(p.id, p.variants.length);
      const sel = p.variants.filter((v) => this.selectedVariantIds.has(v.id)).map((v) => v.id);
      if (sel.length > 0) productSelectedVariantIds.set(p.id, sel);
    }

    const productIds: number[] = [];
    const variantIds: number[] = [];
    const handledVariantIds = new Set<number>();

    for (const [productId, selVarIds] of productSelectedVariantIds) {
      const total = productTotalVariants.get(productId) ?? 0;
      if (total > 0 && selVarIds.length === total) {
        productIds.push(productId);
      } else {
        for (const vid of selVarIds) variantIds.push(vid);
      }
      for (const vid of selVarIds) handledVariantIds.add(vid);
    }

    // Any selected variants whose products weren't loaded this session:
    // send them as individual variant assignments.
    for (const vid of this.selectedVariantIds) {
      if (!handledVariantIds.has(vid)) variantIds.push(vid);
    }

    return { productIds, variantIds };
  }

  save(): void {
    if (!this.canSave() || this.saveState === 'saving') return;
    this.saveState = 'saving';

    const body: any = {
      name: this.form.name.trim(),
      description: this.form.description.trim() || null,
      type: this.form.type,
      percentValue: this.form.percentValue,
      flatValue: this.form.flatValue,
      buyQty: this.form.buyQty,
      getQty: this.form.getQty,
      priority: this.form.priority,
      isActive: this.form.isActive,
      startsAt: this.form.startsAt ? new Date(this.form.startsAt).toISOString() : null,
      endsAt: this.form.endsAt ? new Date(this.form.endsAt).toISOString() : null,
    };

    const afterSave = (offerId: number) => {
      const assignments = this.buildAssignmentPayload();
      this.api
        .put<ApiResponse<unknown>>(`/offers/${offerId}/assignments`, assignments)
        .subscribe({
          next: () => {
            this.saveState = 'idle';
            this.notification.success('Offer saved');
            if (this.isNew) {
              this.router.navigate(['/offers', offerId]);
            }
          },
          error: () => {
            this.saveState = 'idle';
          },
        });
    };

    if (this.isNew) {
      this.api.post<ApiResponse<Offer>>('/offers', body).subscribe({
        next: (res) => {
          this.offerId = res.data.id;
          this.isNew = false;
          afterSave(res.data.id);
        },
        error: () => {
          this.saveState = 'idle';
        },
      });
    } else {
      this.api.put<ApiResponse<Offer>>(`/offers/${this.offerId}`, body).subscribe({
        next: () => afterSave(this.offerId!),
        error: () => {
          this.saveState = 'idle';
        },
      });
    }
  }

  readonly typeLabels = OFFER_TYPE_LABELS;

  /** Unique list of color values in a product's variants — for grouping in the expand view */
  variantsByColor(product: Product): Array<{ color: string; variants: Variant[] }> {
    const map = new Map<string, Variant[]>();
    for (const v of product.variants) {
      const arr = map.get(v.color) ?? [];
      arr.push(v);
      map.set(v.color, arr);
    }
    return [...map.entries()].map(([color, variants]) => ({ color, variants }));
  }
}
