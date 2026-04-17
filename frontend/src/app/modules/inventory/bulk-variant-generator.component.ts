import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { VendorPickerComponent } from '../vendors/vendor-picker.component';

type SizeMode = 'alpha' | 'numeric_even' | 'numeric_odd' | 'custom';
type PricingMode = 'flat' | 'step';

export interface ColorOption {
  id: number;
  name: string;
  hex?: string | null;
}

interface PreviewRow {
  size: string;
  color: string;
  sku: string;
  price: number;
  initialStock: number;
  include: boolean;
  key: string; // size|color for tracking
}

const ALPHA_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];

@Component({
  selector: 'app-bulk-variant-generator',
  standalone: true,
  imports: [CommonModule, FormsModule, VendorPickerComponent],
  templateUrl: './bulk-variant-generator.component.html',
})
export class BulkVariantGeneratorComponent implements OnInit, OnChanges {
  /** If set, the generator will POST directly to that product's bulk endpoint. */
  @Input() productId: number | null = null;
  /** Brand name, used for the SKU base preview (optional). */
  @Input() brandName = '';
  /** Product name, used for the SKU base preview (optional). */
  @Input() productName = '';
  /** Default base price to pre-fill (usually the product's basePrice). */
  @Input() defaultPrice: number | null = null;
  /** Cost price from the product — used for margin calculation. */
  @Input() costPrice: number | null = null;
  /** Landing price from the product — used for margin calculation. */
  @Input() landingPrice: number | null = null;
  /**
   * Shared color palette loaded by the parent. Passed in (rather than
   * fetched here) so the "+ New Color" flow in the parent can mutate one
   * list and both pickers see it immediately via input binding.
   */
  @Input() availableColors: ColorOption[] = [];

  @Output() variantsGenerated = new EventEmitter<void>();
  /** Emitted when running in inline/create mode (no productId) — gives the
   *  caller the list of variants to attach to the product-create payload. */
  @Output() previewChange = new EventEmitter<Array<{ size: string; color: string; priceOverride?: number; sku?: string; initialStock?: number }>>();
  /**
   * Fired when the cashier taps "+ New Color". The parent owns the
   * inline-add form and the API call, then mutates `availableColors`
   * so we re-render without any coupling.
   */
  @Output() requestNewColor = new EventEmitter<void>();
  /** Emitted after a color is created inline so the parent can update its list. */
  @Output() colorCreated = new EventEmitter<ColorOption>();

  expanded = false;

  sizeMode: SizeMode = 'alpha';
  alphaStart = 'S';
  alphaEnd = 'XL';
  numericStart = 10;
  numericEnd = 44;
  customSizes = '';

  /** Names of colors the cashier picked (subset of `availableColors` names). */
  colors: string[] = [];

  pricingMode: PricingMode = 'flat';
  flatPrice: number | null = null;
  stepBase: number | null = null;
  stepIncrement: number | null = 0;

  initialStock: number | null = null;
  skuBase = '';
  vendorId: number | null = null;

  sortBy: 'size' | 'color' = 'size';
  marginBase: 'cost' | 'landing' = 'cost';
  // Inline color creation
  addingColor = false;
  newColorName = '';
  newColorHex = '';
  savingColor = false;

  excluded = new Set<string>();
  /** Per-variant stock overrides (key → quantity). Overrides the global initialStock. */
  stockOverrides = new Map<string, number>();
  generating = false;

  readonly alphaSizes = ALPHA_SIZES;

  constructor(
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    if (this.defaultPrice !== null) {
      this.flatPrice = this.defaultPrice;
      this.stepBase = this.defaultPrice;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['defaultPrice'] && this.defaultPrice !== null) {
      // Sync prices if they haven't been manually changed from the previous default
      const prev = changes['defaultPrice'].previousValue;
      if (this.flatPrice === null || this.flatPrice === prev) {
        this.flatPrice = this.defaultPrice;
      }
      if (this.stepBase === null || this.stepBase === prev) {
        this.stepBase = this.defaultPrice;
      }
    }
  }

  toggle(): void {
    this.expanded = !this.expanded;
  }

  // ─── Color palette selection ────────────────────────

  isColorSelected(name: string): boolean {
    return this.colors.some((c) => c.toLowerCase() === name.toLowerCase());
  }

  toggleColor(name: string): void {
    const idx = this.colors.findIndex(
      (c) => c.toLowerCase() === name.toLowerCase()
    );
    if (idx >= 0) this.colors.splice(idx, 1);
    else this.colors.push(name);
    this.emitPreviewIfInlineMode();
  }

  removeColor(index: number): void {
    this.colors.splice(index, 1);
    this.emitPreviewIfInlineMode();
  }

  /** Show inline color form right below the color chips. */
  onAddColorClicked(): void {
    this.addingColor = true;
    this.newColorName = '';
    this.newColorHex = '';
  }

  cancelAddColor(): void {
    this.addingColor = false;
    this.newColorName = '';
    this.newColorHex = '';
  }

  saveNewColor(): void {
    const name = this.newColorName.trim();
    if (!name || this.savingColor) return;
    this.savingColor = true;

    const payload: Record<string, string> = { name };
    const hex = this.newColorHex.trim();
    if (hex) {
      payload['hex'] = hex.startsWith('#') ? hex : `#${hex}`;
    }

    this.api.post<any>('/colors', payload).subscribe({
      next: (res: any) => {
        const color: ColorOption = res.data;
        this.colorCreated.emit(color);
        this.cancelAddColor();
        this.savingColor = false;
        this.notification.success(`Color "${color.name}" created`);
      },
      error: (err: any) => {
        this.savingColor = false;
        this.notification.error(err.error?.error || 'Failed to create color');
      },
    });
  }

  /** Lookup helper so the template can render swatch hex by color name. */
  getHexForColor(name: string): string | null {
    const hit = this.availableColors.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    return hit?.hex ?? null;
  }

  // ─── Size resolution ────────────────────────────────

  get resolvedSizes(): string[] {
    switch (this.sizeMode) {
      case 'alpha': {
        const startIdx = ALPHA_SIZES.indexOf(this.alphaStart);
        const endIdx = ALPHA_SIZES.indexOf(this.alphaEnd);
        if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return [];
        return ALPHA_SIZES.slice(startIdx, endIdx + 1);
      }
      case 'numeric_even': {
        const out: string[] = [];
        const s = Number(this.numericStart);
        const e = Number(this.numericEnd);
        if (isNaN(s) || isNaN(e) || e < s) return [];
        // Start from first even >= s
        let i = s % 2 === 0 ? s : s + 1;
        while (i <= e) {
          out.push(String(i));
          i += 2;
        }
        return out;
      }
      case 'numeric_odd': {
        const out: string[] = [];
        const s = Number(this.numericStart);
        const e = Number(this.numericEnd);
        if (isNaN(s) || isNaN(e) || e < s) return [];
        let i = s % 2 === 1 ? s : s + 1;
        while (i <= e) {
          out.push(String(i));
          i += 2;
        }
        return out;
      }
      case 'custom': {
        return this.customSizes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
  }

  // ─── Preview rows (cartesian product) ───────────────

  get previewRows(): PreviewRow[] {
    const sizes = this.resolvedSizes;
    const colors = this.colors.length > 0 ? this.colors : [''];

    const rows: PreviewRow[] = [];
    // Build the cartesian product — outer/inner loop order determines default grouping
    const outer = this.sortBy === 'color' && colors.length > 1 ? colors : sizes;
    const inner = this.sortBy === 'color' && colors.length > 1 ? sizes : colors;

    for (let oi = 0; oi < outer.length; oi++) {
      for (const iv of inner) {
        const size = this.sortBy === 'color' && colors.length > 1 ? iv : outer[oi];
        const color = this.sortBy === 'color' && colors.length > 1 ? outer[oi] : iv;
        const sizeIndex = sizes.indexOf(size);
        const price = this.computePrice(sizeIndex);
        const sku = this.computeSku(size, color);
        const key = `${size.toLowerCase()}|${color.toLowerCase()}`;
        const stock = this.stockOverrides.has(key)
          ? this.stockOverrides.get(key)!
          : (this.initialStock ?? 0);
        rows.push({
          size,
          color,
          sku,
          price,
          initialStock: stock,
          include: !this.excluded.has(key),
          key,
        });
      }
    }
    return rows;
  }

  get includedCount(): number {
    return this.previewRows.filter((r) => r.include).length;
  }

  get totalStock(): number {
    return this.previewRows.filter((r) => r.include).reduce((sum, r) => sum + r.initialStock, 0);
  }

  get totalCostValue(): number {
    const cost = Number(this.costPrice || 0);
    return this.previewRows.filter((r) => r.include).reduce((sum, r) => sum + r.initialStock * cost, 0);
  }

  get totalSellingValue(): number {
    return this.previewRows.filter((r) => r.include).reduce((sum, r) => sum + r.initialStock * r.price, 0);
  }

  private computePrice(sizeIndex: number): number {
    if (this.pricingMode === 'flat') {
      return Number(this.flatPrice || 0);
    }
    const base = Number(this.stepBase || 0);
    const inc = Number(this.stepIncrement || 0);
    return base + inc * sizeIndex;
  }

  private computeSku(size: string, color: string): string {
    const base = this.skuBase.trim();
    if (base) {
      const parts = [base];
      if (size) parts.push(size.toUpperCase());
      if (color) parts.push(color.substring(0, 3).toUpperCase());
      return parts.join('-');
    }
    // Empty → backend will auto-generate
    return '(auto)';
  }

  get marginCostBase(): number | null {
    if (this.marginBase === 'landing' && this.landingPrice && this.landingPrice > 0) {
      return this.landingPrice;
    }
    if (this.costPrice && this.costPrice > 0) {
      return this.costPrice;
    }
    return null;
  }

  computeMargin(sellingPrice: number): number | null {
    const base = this.marginCostBase;
    if (!base || base <= 0 || sellingPrice <= 0) return null;
    return Math.floor(((sellingPrice - base) / base) * 10000) / 100;
  }

  onStockChange(row: PreviewRow, value: number): void {
    const qty = Math.max(0, Math.floor(value || 0));
    this.stockOverrides.set(row.key, qty);
    this.emitPreviewIfInlineMode();
  }

  toggleRow(row: PreviewRow): void {
    if (this.excluded.has(row.key)) {
      this.excluded.delete(row.key);
    } else {
      this.excluded.add(row.key);
    }
    this.emitPreviewIfInlineMode();
  }

  onInputChange(): void {
    // Clear excluded list when inputs change drastically
    this.emitPreviewIfInlineMode();
  }

  // ─── Submission ─────────────────────────────────────

  get canGenerate(): boolean {
    const rows = this.previewRows;
    if (rows.length === 0) return false;
    if (this.includedCount === 0) return false;
    if (this.pricingMode === 'flat' && !(this.flatPrice && this.flatPrice > 0)) return false;
    if (this.pricingMode === 'step' && !(this.stepBase && this.stepBase > 0)) return false;
    return true;
  }

  buildVariantPayloads(): Array<{ size: string; color: string; priceOverride?: number; sku?: string; initialStock?: number }> {
    return this.previewRows
      .filter((r) => r.include)
      .map((r) => {
        const payload: any = {
          size: r.size,
          color: r.color || 'Default',
        };
        if (r.price > 0) payload.priceOverride = r.price;
        if (this.skuBase.trim()) payload.sku = r.sku;
        if (r.initialStock > 0) payload.initialStock = r.initialStock;
        return payload;
      });
  }

  private emitPreviewIfInlineMode(): void {
    // When there's no productId, this component is used inline within a
    // product-create flow and just publishes its variant preview.
    if (!this.productId) {
      this.previewChange.emit(this.buildVariantPayloads());
    }
  }

  generate(): void {
    if (!this.canGenerate || this.generating) return;
    if (!this.productId) {
      // Inline mode: we already emit via previewChange; caller handles POST
      this.notification.info('Variants ready — save the product to create them');
      return;
    }

    this.generating = true;
    const payload: any = {
      variants: this.buildVariantPayloads(),
    };
    if (this.vendorId) payload.vendorId = this.vendorId;

    this.api.post<any>(`/products/${this.productId}/variants/bulk`, payload).subscribe({
      next: (res) => {
        const created = res.data?.created?.length || 0;
        const skipped = res.data?.skipped?.length || 0;
        let msg = `Created ${created} variant${created === 1 ? '' : 's'}`;
        if (skipped) msg += `, skipped ${skipped}`;
        this.notification.success(msg);
        this.generating = false;
        this.reset();
        this.variantsGenerated.emit();
      },
      error: (err) => {
        this.generating = false;
        this.notification.error(
          err.error?.error || err.error?.message || 'Failed to generate variants'
        );
      },
    });
  }

  reset(): void {
    this.colors = [];
    this.excluded.clear();
    this.stockOverrides.clear();
    this.expanded = false;
    this.customSizes = '';
  }
}
