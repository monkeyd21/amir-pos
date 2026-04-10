import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragEnd } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';

// ─── Types (mirror backend) ──────────────────────────────────────

type LabelElementType =
  | 'brand'
  | 'productName'
  | 'variant'
  | 'barcode'
  | 'sku'
  | 'price'
  | 'text';

type TextAlign = 'left' | 'center' | 'right';

interface LabelElement {
  id: string;
  type: LabelElementType;
  x: number;
  y: number;
  visible?: boolean;
  font?: number;
  xScale?: number;
  yScale?: number;
  align?: TextAlign;
  width?: number;
  content?: string;
  barcodeHeight?: number;
  showBarcodeText?: boolean;
  bold?: boolean;
  underline?: boolean;
}

interface LabelTemplate {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  density: number;
  speed: number;
  elements: LabelElement[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// ─── Constants ───────────────────────────────────────────────────

const DPI = 203;
const DOTS_PER_MM = DPI / 25.4;

/** Character width in dots for each TSPL internal font at xScale=1 */
const FONT_CHAR_WIDTH: Record<number, number> = {
  1: 8,
  2: 12,
  3: 16,
  4: 24,
  5: 32,
};
const FONT_CHAR_HEIGHT: Record<number, number> = {
  1: 12,
  2: 20,
  3: 24,
  4: 32,
  5: 48,
};

const ELEMENT_TYPE_LABELS: Record<LabelElementType, string> = {
  brand: 'Brand',
  productName: 'Product Name',
  variant: 'Size / Color',
  barcode: 'Barcode',
  sku: 'SKU Text',
  price: 'Price',
  text: 'Custom Text',
};

/** Sample data shown in the live preview */
const PREVIEW_DATA = {
  productName: 'Slim Fit Denim',
  variantLabel: 'M / Indigo',
  sku: '2009676797946',
  price: 4299,
};

@Component({
  selector: 'app-label-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, CdkDrag, PageHeaderComponent],
  templateUrl: './label-designer.component.html',
})
export class LabelDesignerComponent implements OnInit {
  @ViewChild('canvas') canvasRef?: ElementRef<HTMLDivElement>;

  // State
  template: LabelTemplate | null = null;
  selectedId: string | null = null;
  loading = false;
  saving = false;
  printing = false;

  // Canvas scale (px per dot) — computed from widget width
  scale = 2;

  // Element type palette
  readonly palette: { type: LabelElementType; label: string; icon: string }[] = [
    { type: 'brand', label: 'Brand', icon: 'storefront' },
    { type: 'productName', label: 'Product Name', icon: 'label' },
    { type: 'variant', label: 'Size / Color', icon: 'palette' },
    { type: 'barcode', label: 'Barcode', icon: 'qr_code_2' },
    { type: 'sku', label: 'SKU Text', icon: 'tag' },
    { type: 'price', label: 'Price', icon: 'payments' },
    { type: 'text', label: 'Custom Text', icon: 'text_fields' },
  ];

  readonly alignOptions: { value: TextAlign; label: string }[] = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ];

  readonly fontOptions = [
    { value: 1, label: '1 — Tiny (8×12)' },
    { value: 2, label: '2 — Small (12×20)' },
    { value: 3, label: '3 — Medium (16×24)' },
    { value: 4, label: '4 — Large (24×32)' },
    { value: 5, label: '5 — X-Large (32×48)' },
  ];

  constructor(
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadTemplate();
  }

  // ─── Load / Save ─────────────────────────────────────────────

  loadTemplate(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<LabelTemplate>>('/settings/label-template')
      .subscribe({
        next: (res) => {
          this.template = this.normalize(res.data);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load label template');
        },
      });
  }

  saveTemplate(): void {
    if (!this.template || this.saving) return;
    this.saving = true;
    this.api
      .put<ApiResponse<LabelTemplate>>('/settings/label-template', this.template)
      .subscribe({
        next: (res) => {
          this.template = this.normalize(res.data);
          this.saving = false;
          this.notification.success('Label template saved');
        },
        error: () => {
          this.saving = false;
        },
      });
  }

  resetTemplate(): void {
    if (!confirm('Reset label template to defaults? Unsaved changes will be lost.')) return;
    this.api
      .post<ApiResponse<LabelTemplate>>('/settings/label-template/reset', {})
      .subscribe({
        next: (res) => {
          this.template = this.normalize(res.data);
          this.selectedId = null;
          this.notification.success('Template reset to defaults');
        },
      });
  }

  testPrint(): void {
    if (!this.template || this.printing) return;
    this.printing = true;
    // Send the current (unsaved) template so the user can preview edits without saving first
    this.api
      .post<ApiResponse<unknown>>('/inventory/barcodes/test-print', {
        template: this.template,
      })
      .subscribe({
        next: () => {
          this.printing = false;
          this.notification.success('Test label sent to printer');
        },
        error: () => {
          this.printing = false;
        },
      });
  }

  // ─── Element operations ──────────────────────────────────────

  addElement(type: LabelElementType): void {
    if (!this.template) return;

    // Generate unique id: base type + counter if duplicate exists
    let id: string = type;
    let counter = 2;
    while (this.template.elements.some((e) => e.id === id)) {
      id = `${type}${counter++}`;
    }

    const base: LabelElement = {
      id,
      type,
      x: 20,
      y: 20,
      visible: true,
      font: 3,
      xScale: 1,
      yScale: 1,
      align: 'left',
    };

    if (type === 'barcode') {
      base.x = 40;
      base.barcodeHeight = 80;
      base.showBarcodeText = true;
    } else if (type === 'brand') {
      base.font = 4;
      base.content = 'BRAND';
      base.align = 'center';
      base.width = this.labelWidthDots - 40;
    } else if (type === 'price') {
      base.font = 5;
      base.content = 'Rs.';
      base.align = 'center';
      base.width = this.labelWidthDots - 40;
    } else if (type === 'text') {
      base.font = 2;
      base.content = 'Text';
    } else {
      base.align = 'center';
      base.width = this.labelWidthDots - 40;
    }

    this.template.elements.push(base);
    this.selectedId = id;
  }

  removeElement(id: string): void {
    if (!this.template) return;
    this.template.elements = this.template.elements.filter((e) => e.id !== id);
    if (this.selectedId === id) this.selectedId = null;
  }

  duplicateElement(id: string): void {
    if (!this.template) return;
    const src = this.template.elements.find((e) => e.id === id);
    if (!src) return;

    let newId = `${src.id}_copy`;
    let counter = 2;
    while (this.template.elements.some((e) => e.id === newId)) {
      newId = `${src.id}_copy${counter++}`;
    }

    const clone: LabelElement = { ...src, id: newId, x: src.x + 20, y: src.y + 20 };
    this.template.elements.push(clone);
    this.selectedId = newId;
  }

  selectElement(id: string): void {
    this.selectedId = id;
  }

  deselectElement(ev: MouseEvent): void {
    // Clicking empty canvas clears selection
    if (ev.target === ev.currentTarget) {
      this.selectedId = null;
    }
  }

  // ─── Drag handlers (CDK freeDragPosition) ────────────────────

  onDragEnd(el: LabelElement, event: CdkDragEnd): void {
    if (!this.template) return;
    // CDK drag-drop returns the DOM transform offset in pixels.
    // Convert back to dots and add to the element's original position.
    const dist = event.source.getFreeDragPosition();
    const newX = Math.max(0, Math.round(el.x + dist.x / this.scale));
    const newY = Math.max(0, Math.round(el.y + dist.y / this.scale));

    // Clamp within label bounds
    el.x = Math.min(newX, this.labelWidthDots - 10);
    el.y = Math.min(newY, this.labelHeightDots - 10);

    // Reset the CDK drag transform so the next drag starts from the new x/y
    event.source.reset();
  }

  // ─── Derived / preview helpers ───────────────────────────────

  get selectedElement(): LabelElement | null {
    if (!this.template || !this.selectedId) return null;
    return this.template.elements.find((e) => e.id === this.selectedId) ?? null;
  }

  get labelWidthDots(): number {
    return this.template ? Math.round(this.template.widthMm * DOTS_PER_MM) : 400;
  }

  get labelHeightDots(): number {
    return this.template ? Math.round(this.template.heightMm * DOTS_PER_MM) : 600;
  }

  /** Pixel size of the canvas based on scale */
  get canvasWidthPx(): number {
    return this.labelWidthDots * this.scale;
  }

  get canvasHeightPx(): number {
    return this.labelHeightDots * this.scale;
  }

  /** Resolve the text shown inside a given element for the live preview */
  previewText(el: LabelElement): string {
    switch (el.type) {
      case 'brand':
        return el.content ?? '';
      case 'productName':
        return PREVIEW_DATA.productName;
      case 'variant':
        return PREVIEW_DATA.variantLabel;
      case 'sku':
        return PREVIEW_DATA.sku;
      case 'price': {
        const prefix = (el.content ?? '').trim();
        return prefix ? `${prefix} ${PREVIEW_DATA.price}` : String(PREVIEW_DATA.price);
      }
      case 'text':
        return el.content ?? '';
      default:
        return '';
    }
  }

  /** Compute pixel dimensions of the text box so drag bounds match the printed width */
  elementPixelWidth(el: LabelElement): number {
    if (el.type === 'barcode') {
      // barcode module rendered as a fixed approximate width
      return 240 * this.scale * 0.6;
    }
    if (el.width) return el.width * this.scale;
    // Fallback: measure by text length
    const cw = FONT_CHAR_WIDTH[el.font ?? 3] * (el.xScale ?? 1);
    return this.previewText(el).length * cw * this.scale;
  }

  elementPixelHeight(el: LabelElement): number {
    if (el.type === 'barcode') {
      return (el.barcodeHeight ?? 80) * this.scale + 20 * this.scale;
    }
    return FONT_CHAR_HEIGHT[el.font ?? 3] * (el.yScale ?? 1) * this.scale;
  }

  /** Font size in CSS pixels that approximates the TSPL font on the preview */
  elementFontSizePx(el: LabelElement): number {
    const h = FONT_CHAR_HEIGHT[el.font ?? 3] * (el.yScale ?? 1);
    return h * this.scale * 0.85; // slight shrink so HTML font matches printed size
  }

  elementTextAlignCss(el: LabelElement): string {
    return el.align ?? 'left';
  }

  labelForType(type: LabelElementType): string {
    return ELEMENT_TYPE_LABELS[type];
  }

  isTextElement(el: LabelElement): boolean {
    return el.type !== 'barcode';
  }

  supportsContent(el: LabelElement): boolean {
    return el.type === 'brand' || el.type === 'price' || el.type === 'text';
  }

  contentFieldLabel(el: LabelElement): string {
    if (el.type === 'price') return 'Price Prefix';
    if (el.type === 'brand') return 'Brand Name';
    return 'Text';
  }

  // ─── Sanitization ────────────────────────────────────────────

  /** Ensure template has sane defaults for every element */
  private normalize(t: LabelTemplate): LabelTemplate {
    return {
      widthMm: t.widthMm ?? 50,
      heightMm: t.heightMm ?? 75,
      gapMm: t.gapMm ?? 2,
      density: t.density ?? 8,
      speed: t.speed ?? 4,
      elements: (t.elements ?? []).map((e) => ({
        visible: true,
        font: e.type === 'barcode' ? undefined : 3,
        xScale: 1,
        yScale: 1,
        align: 'left' as TextAlign,
        ...e,
      })),
    };
  }
}
