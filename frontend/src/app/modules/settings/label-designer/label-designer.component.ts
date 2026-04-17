import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CdkDrag, CdkDragEnd } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';

// ─── Types (mirror backend IR) ──────────────────────────────────

type LabelElementType =
  | 'brand'
  | 'productName'
  | 'variant'
  | 'barcode'
  | 'sku'
  | 'price'
  | 'lotCode'
  | 'text';

type TextAlign = 'left' | 'center' | 'right';
type TextWeight = 'normal' | 'bold';
type BarcodeType = 'code128' | 'code39' | 'ean13' | 'ean8' | 'upca' | 'qr';

interface LabelElement {
  id: string;
  type: LabelElementType;
  xMm: number;
  yMm: number;
  visible?: boolean;
  fontSizePt?: number;
  weight?: TextWeight;
  align?: TextAlign;
  widthMm?: number;
  underline?: boolean;
  content?: string;
  barcodeType?: BarcodeType;
  barcodeHeightMm?: number;
  showBarcodeText?: boolean;
}

interface LabelTemplateRow {
  id: number;
  printerProfileId: number;
  name: string;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  density: number;
  speed: number;
  elements: LabelElement[];
  isDefault: boolean;
}

interface PrinterProfile {
  id: number;
  name: string;
  vendor: string;
  model: string | null;
  driver: string;
  transport: string;
  dpi: number;
  maxWidthMm: number;
  capabilities: { supportedBarcodes?: BarcodeType[] };
  isDefault: boolean;
  templates: { id: number; name: string; isDefault: boolean; widthMm: number; heightMm: number }[];
}

interface DriverDescriptor {
  name: string;
  displayName: string;
  capabilities: {
    supportedBarcodes: BarcodeType[];
    unicode: boolean;
    nativeBold: boolean;
    densityRange: [number, number];
    speedRange: [number, number];
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// ─── Constants ───────────────────────────────────────────────────

const ELEMENT_TYPE_LABELS: Record<LabelElementType, string> = {
  brand: 'Brand',
  productName: 'Product Name',
  variant: 'Size / Color',
  barcode: 'Barcode',
  sku: 'SKU Text',
  price: 'Price',
  lotCode: 'Lot Code',
  text: 'Custom Text',
};

const PREVIEW_DATA = {
  productName: 'Slim Fit Denim',
  variantLabel: 'M / Indigo',
  sku: '2009676797946',
  lotCode: 'LOT-2026-04-001',
  price: 4299,
};

@Component({
  selector: 'app-label-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, CdkDrag, RouterLink, PageHeaderComponent],
  templateUrl: './label-designer.component.html',
})
export class LabelDesignerComponent implements OnInit {
  @ViewChild('canvas') canvasRef?: ElementRef<HTMLDivElement>;

  // Multi-tenant state
  profile: PrinterProfile | null = null;
  drivers: DriverDescriptor[] = [];
  templateRows: LabelTemplateRow[] = [];

  // Active template being edited
  template: LabelTemplateRow | null = null;
  selectedId: string | null = null;

  // UI state
  loading = false;
  saving = false;
  printing = false;

  // Canvas scale: **pixels per mm**. ~3.8 px/mm = screen-accurate on a
  // ~96 DPI monitor; we start zoomed in at 4 px/mm for comfortable editing.
  scale = 4;

  readonly palette: { type: LabelElementType; label: string; icon: string }[] = [
    { type: 'brand', label: 'Brand', icon: 'storefront' },
    { type: 'productName', label: 'Product Name', icon: 'label' },
    { type: 'variant', label: 'Size / Color', icon: 'palette' },
    { type: 'barcode', label: 'Barcode', icon: 'qr_code_2' },
    { type: 'sku', label: 'SKU Text', icon: 'tag' },
    { type: 'price', label: 'Price', icon: 'payments' },
    { type: 'lotCode', label: 'Lot Code', icon: 'inventory_2' },
    { type: 'text', label: 'Custom Text', icon: 'text_fields' },
  ];

  readonly alignOptions: { value: TextAlign; label: string }[] = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ];

  /** Discrete font-size suggestions (pt). Users can type any value too. */
  readonly fontSizeOptions = [6, 8, 10, 12, 14, 18, 24, 32, 48];

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    const profileId = Number(this.route.snapshot.paramMap.get('profileId'));
    const templateId = Number(this.route.snapshot.paramMap.get('templateId'));
    if (!profileId) {
      this.notification.error('No printer profile specified');
      this.router.navigate(['/settings']);
      return;
    }
    this.load(profileId, templateId || undefined);
  }

  // ─── Load / Save ─────────────────────────────────────────────

  load(profileId: number, templateId?: number): void {
    this.loading = true;
    // Fetch profile (with templates list) + driver capabilities in parallel
    Promise.all([
      this.fetchProfile(profileId),
      this.fetchDrivers(),
    ])
      .then(() => {
        if (!this.profile) {
          this.loading = false;
          return;
        }
        const targetId = templateId ?? this.profile.templates.find((t) => t.isDefault)?.id ?? this.profile.templates[0]?.id;
        if (!targetId) {
          this.loading = false;
          this.notification.warning('This printer has no templates — add one first.');
          return;
        }
        this.loadTemplate(targetId);
      })
      .catch(() => {
        this.loading = false;
        this.notification.error('Failed to load printer profile');
      });
  }

  private fetchProfile(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.api.get<ApiResponse<PrinterProfile>>(`/printing/profiles/${id}`).subscribe({
        next: (res) => {
          this.profile = res.data;
          resolve();
        },
        error: reject,
      });
    });
  }

  private fetchDrivers(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.api.get<ApiResponse<DriverDescriptor[]>>('/printing/drivers').subscribe({
        next: (res) => {
          this.drivers = res.data;
          resolve();
        },
        error: reject,
      });
    });
  }

  loadTemplate(templateId: number): void {
    this.api.get<ApiResponse<LabelTemplateRow>>(`/printing/templates/${templateId}`).subscribe({
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
    const { id, printerProfileId: _pid, ...body } = this.template;
    this.api
      .put<ApiResponse<LabelTemplateRow>>(`/printing/templates/${id}`, body)
      .subscribe({
        next: (res) => {
          this.template = this.normalize(res.data);
          this.saving = false;
          this.notification.success('Label template saved');
        },
        error: () => (this.saving = false),
      });
  }

  testPrint(): void {
    if (!this.profile || !this.template || this.printing) return;
    this.printing = true;
    this.api
      .post<ApiResponse<unknown>>(`/printing/profiles/${this.profile.id}/test`, {
        overrideTemplate: {
          widthMm: this.template.widthMm,
          heightMm: this.template.heightMm,
          gapMm: this.template.gapMm,
          density: this.template.density,
          speed: this.template.speed,
          elements: this.template.elements,
        },
      })
      .subscribe({
        next: () => {
          this.printing = false;
          this.notification.success('Test label sent to printer');
        },
        error: () => (this.printing = false),
      });
  }

  // ─── Element operations ──────────────────────────────────────

  addElement(type: LabelElementType): void {
    if (!this.template || !this.profile) return;

    let id: string = type;
    let counter = 2;
    while (this.template.elements.some((e) => e.id === id)) {
      id = `${type}${counter++}`;
    }

    const base: LabelElement = {
      id,
      type,
      xMm: 2.5,
      yMm: 2.5,
      visible: true,
      fontSizePt: 12,
      weight: 'normal',
      align: 'left',
    };

    const innerWidthMm = this.template.widthMm - 5;

    if (type === 'barcode') {
      base.xMm = 5;
      base.barcodeType = this.defaultBarcodeType();
      base.barcodeHeightMm = 10;
      base.showBarcodeText = true;
    } else if (type === 'brand') {
      base.fontSizePt = 18;
      base.content = 'BRAND';
      base.align = 'center';
      base.widthMm = innerWidthMm;
    } else if (type === 'price') {
      base.fontSizePt = 24;
      base.content = 'Rs.';
      base.align = 'center';
      base.widthMm = innerWidthMm;
    } else if (type === 'text') {
      base.fontSizePt = 10;
      base.content = 'Text';
    } else {
      base.align = 'center';
      base.widthMm = innerWidthMm;
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

    const clone: LabelElement = {
      ...src,
      id: newId,
      xMm: src.xMm + 2,
      yMm: src.yMm + 2,
    };
    this.template.elements.push(clone);
    this.selectedId = newId;
  }

  selectElement(id: string): void {
    this.selectedId = id;
  }

  deselectElement(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) {
      this.selectedId = null;
    }
  }

  // ─── Drag handler (CDK free drag) ───────────────────────────

  onDragEnd(el: LabelElement, event: CdkDragEnd): void {
    if (!this.template) return;
    const dist = event.source.getFreeDragPosition();
    // Convert pixel delta → mm delta (scale is px/mm)
    const newXMm = Math.max(0, el.xMm + dist.x / this.scale);
    const newYMm = Math.max(0, el.yMm + dist.y / this.scale);

    el.xMm = Math.min(newXMm, this.template.widthMm - 1);
    el.yMm = Math.min(newYMm, this.template.heightMm - 1);

    event.source.reset();
  }

  // ─── Derived properties ─────────────────────────────────────

  get selectedElement(): LabelElement | null {
    if (!this.template || !this.selectedId) return null;
    return this.template.elements.find((e) => e.id === this.selectedId) ?? null;
  }

  get activeDriver(): DriverDescriptor | undefined {
    return this.profile
      ? this.drivers.find((d) => d.name === this.profile!.driver)
      : undefined;
  }

  /** Barcodes available for the current driver — used to filter the dropdown. */
  get availableBarcodeTypes(): BarcodeType[] {
    return this.activeDriver?.capabilities.supportedBarcodes ?? ['code128'];
  }

  defaultBarcodeType(): BarcodeType {
    return this.availableBarcodeTypes.includes('code128')
      ? 'code128'
      : this.availableBarcodeTypes[0];
  }

  /** Canvas pixel dimensions derived from label mm × scale. */
  get canvasWidthPx(): number {
    return this.template ? this.template.widthMm * this.scale : 200;
  }

  get canvasHeightPx(): number {
    return this.template ? this.template.heightMm * this.scale : 300;
  }

  /** Max label width in mm that the selected printer can physically print. */
  get maxLabelWidthMm(): number {
    return this.profile?.maxWidthMm ?? 200;
  }

  /** 1 pt = 0.3528 mm → 1 pt = 0.3528 × scale pixels. */
  ptToCssPx(pt: number): number {
    return pt * 0.3528 * this.scale;
  }

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
      case 'lotCode':
        return PREVIEW_DATA.lotCode;
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

  elementPixelWidth(el: LabelElement): number {
    if (el.type === 'barcode') {
      // Rough approximation: 40 mm wide Code 128 / QR
      return 40 * this.scale;
    }
    if (el.widthMm) return el.widthMm * this.scale;
    const chars = Math.max(1, this.previewText(el).length);
    // Approximate: char width = fontSizePt * 0.6 (ratio) * 0.3528 mm/pt
    return chars * (el.fontSizePt ?? 12) * 0.6 * 0.3528 * this.scale;
  }

  elementPixelHeight(el: LabelElement): number {
    if (el.type === 'barcode') {
      const h = el.barcodeHeightMm ?? 10;
      return (h + (el.showBarcodeText !== false ? 3 : 0)) * this.scale;
    }
    return this.ptToCssPx(el.fontSizePt ?? 12);
  }

  elementFontSizePx(el: LabelElement): number {
    return this.ptToCssPx(el.fontSizePt ?? 12);
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

  private normalize(t: LabelTemplateRow): LabelTemplateRow {
    return {
      ...t,
      widthMm: t.widthMm ?? 50,
      heightMm: t.heightMm ?? 75,
      gapMm: t.gapMm ?? 2,
      density: t.density ?? 8,
      speed: t.speed ?? 4,
      elements: (t.elements ?? []).map((e) => ({
        visible: true,
        fontSizePt: 12,
        weight: 'normal' as TextWeight,
        align: 'left' as TextAlign,
        ...e,
      })),
    };
  }
}
