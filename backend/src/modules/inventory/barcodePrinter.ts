import { promises as fs } from 'fs';
import { AppError } from '../../middleware/errorHandler';

const DEVICE_PATH = process.env.BARCODE_PRINTER_DEVICE || '/dev/usb/lp0';
const DPI = 203; // TSC/Zenpert default
const DOTS_PER_MM = DPI / 25.4; // ~8 dots/mm

// ─── Types ───────────────────────────────────────────────────────

export interface BarcodeLabel {
  sku: string;
  productName: string;
  variantLabel?: string;
  price: number;
  copies?: number;
}

export type LabelElementType =
  | 'brand'
  | 'productName'
  | 'variant'
  | 'barcode'
  | 'sku'
  | 'price'
  | 'text';

export type TextAlign = 'left' | 'center' | 'right';

/**
 * A single positioned element on the label. Coordinates are in **dots** (8/mm @ 203 DPI)
 * measured from the top-left corner of the label.
 */
export interface LabelElement {
  id: string;
  type: LabelElementType;
  x: number;            // dots
  y: number;            // dots
  visible?: boolean;    // default true
  font?: number;        // 1-5 TSPL internal font (1=small, 5=large)
  xScale?: number;      // 1-10 width multiplier
  yScale?: number;      // 1-10 height multiplier
  align?: TextAlign;    // text alignment when width is set
  width?: number;       // optional bounding width (dots) — used for alignment
  content?: string;     // static text (brand, text) or prefix (price)
  barcodeHeight?: number; // dots, for type=barcode
  showBarcodeText?: boolean; // for type=barcode — readable number under bars
  // Text styling (text-type elements only)
  bold?: boolean;       // simulated via double-strike (prints text twice, 1-dot offset)
  underline?: boolean;  // drawn as a BAR under the text at its measured width
}

export interface LabelTemplate {
  widthMm: number;      // label width
  heightMm: number;     // label height
  gapMm: number;        // gap between labels (sensor gap)
  density: number;      // 1-15, darkness
  speed: number;        // inches/sec
  elements: LabelElement[];
}

// ─── Default template ────────────────────────────────────────────

export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  widthMm: 50,
  heightMm: 75,
  gapMm: 2,
  density: 8,
  speed: 4,
  elements: [
    {
      id: 'brand',
      type: 'brand',
      x: 20,
      y: 20,
      font: 4,
      xScale: 1,
      yScale: 1,
      align: 'center',
      width: 360,
      content: 'ATELIER',
      visible: true,
    },
    {
      id: 'productName',
      type: 'productName',
      x: 20,
      y: 70,
      font: 3,
      xScale: 1,
      yScale: 1,
      align: 'center',
      width: 360,
      visible: true,
    },
    {
      id: 'variant',
      type: 'variant',
      x: 20,
      y: 110,
      font: 2,
      xScale: 1,
      yScale: 1,
      align: 'center',
      width: 360,
      visible: true,
    },
    {
      id: 'barcode',
      type: 'barcode',
      x: 40,
      y: 150,
      barcodeHeight: 100,
      showBarcodeText: true,
      visible: true,
    },
    {
      id: 'price',
      type: 'price',
      x: 20,
      y: 310,
      font: 5,
      xScale: 1,
      yScale: 1,
      align: 'center',
      width: 360,
      content: 'Rs.',
      visible: true,
    },
    {
      id: 'footer',
      type: 'text',
      x: 20,
      y: 380,
      font: 2,
      xScale: 1,
      yScale: 1,
      align: 'center',
      width: 360,
      content: '',
      visible: false,
    },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────

function sanitizeTspl(text: string): string {
  return text
    .replace(/[\r\n]/g, ' ')
    .replace(/"/g, "'")
    .replace(/[^\x20-\x7E]/g, '') // strip non-ASCII (TSPL internal fonts are ASCII)
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + '.';
}

/**
 * TSPL internal font character widths in dots (x-scale = 1):
 *   font 1 = 8 wide, 12 tall
 *   font 2 = 12 wide, 20 tall
 *   font 3 = 16 wide, 24 tall
 *   font 4 = 24 wide, 32 tall
 *   font 5 = 32 wide, 48 tall
 */
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

function charWidth(font: number, xScale: number): number {
  return (FONT_CHAR_WIDTH[font] || 16) * Math.max(1, xScale);
}

/**
 * Compute x offset for text alignment within an optional bounding width.
 * If width is absent, align is ignored and x is returned verbatim.
 */
function alignedX(el: LabelElement, text: string): number {
  if (!el.width || !el.align || el.align === 'left') return el.x;
  const cw = charWidth(el.font || 3, el.xScale || 1);
  const textWidth = text.length * cw;
  const free = el.width - textWidth;
  if (free <= 0) return el.x;
  if (el.align === 'center') return el.x + Math.floor(free / 2);
  return el.x + free; // right
}

// ─── Element → TSPL ──────────────────────────────────────────────

function resolveText(el: LabelElement, data: BarcodeLabel): string {
  switch (el.type) {
    case 'brand':
      return el.content ?? '';
    case 'productName':
      return data.productName;
    case 'variant':
      return data.variantLabel ?? '';
    case 'sku':
      return data.sku;
    case 'price': {
      const prefix = (el.content ?? '').trim();
      const amount = Math.round(data.price);
      return prefix ? `${prefix} ${amount}` : String(amount);
    }
    case 'text':
      return el.content ?? '';
    default:
      return '';
  }
}

function renderElement(el: LabelElement, data: BarcodeLabel): string[] {
  if (el.visible === false) return [];

  if (el.type === 'barcode') {
    const sku = sanitizeTspl(data.sku);
    if (!sku) return [];
    const height = Math.max(20, el.barcodeHeight ?? 80);
    const readable = el.showBarcodeText === false ? 0 : 1;
    return [`BARCODE ${el.x},${el.y},"128",${height},${readable},0,2,2,"${sku}"`];
  }

  const raw = resolveText(el, data);
  if (!raw) return [];

  const font = el.font ?? 3;
  const xScale = el.xScale ?? 1;
  const yScale = el.yScale ?? 1;

  // Truncate to fit width if a width is specified
  let text = sanitizeTspl(raw);
  if (el.width) {
    const cw = charWidth(font, xScale);
    const maxChars = Math.max(1, Math.floor(el.width / cw));
    text = truncate(text, maxChars);
  }
  if (!text) return [];

  const x = alignedX(el, text);
  const out: string[] = [`TEXT ${x},${el.y},"${font}",0,${xScale},${yScale},"${text}"`];

  // Bold: double-strike the text 1 dot to the right (classic thermal printer bold trick).
  // Works with internal bitmap fonts which have no native bold attribute.
  if (el.bold) {
    out.push(`TEXT ${x + 1},${el.y},"${font}",0,${xScale},${yScale},"${text}"`);
  }

  // Underline: draw a BAR under the text at its measured pixel width.
  // Line sits 2 dots below the character cell, 2 dots thick.
  if (el.underline) {
    const textPixelWidth = text.length * charWidth(font, xScale);
    const textPixelHeight = (FONT_CHAR_HEIGHT[font] || 24) * yScale;
    const barY = el.y + textPixelHeight + 2;
    const barThickness = 2;
    out.push(`BAR ${x},${barY},${textPixelWidth},${barThickness}`);
  }

  return out;
}

// ─── Public API ──────────────────────────────────────────────────

export function generateLabelTspl(
  item: BarcodeLabel,
  template: LabelTemplate
): string {
  const copies = Math.max(1, Math.min(item.copies ?? 1, 99));
  const lines: string[] = [
    `SIZE ${template.widthMm} mm,${template.heightMm} mm`,
    `GAP ${template.gapMm} mm,0`,
    'DIRECTION 1',
    `DENSITY ${Math.max(0, Math.min(15, template.density))}`,
    `SPEED ${Math.max(1, Math.min(14, template.speed))}`,
    'CLS',
  ];

  for (const el of template.elements) {
    lines.push(...renderElement(el, item));
  }

  lines.push(`PRINT ${copies},1`);
  return lines.join('\n') + '\n';
}

export function generateBatchTspl(
  items: BarcodeLabel[],
  template: LabelTemplate
): string {
  return items.map((item) => generateLabelTspl(item, template)).join('');
}

// ─── Device write (write-serialized) ─────────────────────────────

let writeChain: Promise<void> = Promise.resolve();

export function printToDevice(tspl: string): Promise<void> {
  const next = writeChain.then(async () => {
    try {
      await fs.writeFile(DEVICE_PATH, tspl, { encoding: 'binary' });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new AppError(
          `Barcode printer not connected (${DEVICE_PATH} not found). Power on the printer and check the USB cable.`,
          503
        );
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new AppError(
          `Permission denied writing to ${DEVICE_PATH}. Install the udev rule or run with sufficient privileges.`,
          503
        );
      }
      if (err.code === 'EIO') {
        throw new AppError(
          'Printer I/O error — check media loaded, head closed, and no paper jam.',
          503
        );
      }
      throw new AppError(`Failed to write to printer: ${err.message}`, 500);
    }
  });
  writeChain = next.catch(() => {});
  return next;
}

// ─── Utility: convert between mm and dots ────────────────────────

export const mmToDots = (mm: number) => Math.round(mm * DOTS_PER_MM);
export const dotsToMm = (dots: number) => dots / DOTS_PER_MM;
