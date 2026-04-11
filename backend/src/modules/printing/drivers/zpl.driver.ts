import {
  Driver,
  DriverCapabilities,
  DriverOutput,
  RenderContext,
} from './base';
import { registerDriver } from './registry';
import {
  BarcodeType,
  LabelData,
  LabelElement,
  LabelTemplate,
} from '../ir/types';
import { asciiSanitize, resolveElementText } from '../ir/resolveText';

/**
 * ZPL II driver for Zebra printers.
 *
 * Covers: Zebra GK/GX420t, ZD220/ZD230/ZD410/ZD420, ZD500, ZD620,
 * ZT230/ZT410/ZT510 industrial, LP 2844 (via ZPL emulation mode),
 * and clones like Honeywell PC42T that support ZPL.
 *
 * Coordinates are in **dots**. Zebra's baseline is 203 DPI (8 dots/mm);
 * 300 DPI printers (~12 dots/mm) are autodetected from the profile DPI
 * and the mm → dots conversion handles both transparently.
 */

// ─── Font size (pt) → ZPL scalable font ^A0 height (dots) ───────
//
// ZPL's ^A0 command takes a scalable font with explicit height and width
// in dots. height_dots = ceil(pt * 0.3528 mm/pt * dotsPerMm).
// Unlike TSPL we don't need font IDs — any size works, DPI-aware.
//
// Width is left at 0 so Zebra auto-fits (roughly 60% of height for most
// fonts — fine for the alignment estimator below).

const FONT_WIDTH_RATIO = 0.6;

const mmToDots = (mm: number, dpi: number) => Math.round((mm * dpi) / 25.4);

function fontHeightDots(fontSizePt: number, dpi: number): number {
  const mm = fontSizePt * 0.3528;
  return Math.max(8, Math.round((mm * dpi) / 25.4));
}

function estimatedCharWidthDots(heightDots: number): number {
  return Math.max(6, Math.round(heightDots * FONT_WIDTH_RATIO));
}

function alignedXDots(
  el: LabelElement,
  text: string,
  heightDots: number,
  dpi: number
): number {
  const baseX = mmToDots(el.xMm, dpi);
  if (!el.widthMm || !el.align || el.align === 'left') return baseX;
  const boxDots = mmToDots(el.widthMm, dpi);
  const textWidth = text.length * estimatedCharWidthDots(heightDots);
  const free = boxDots - textWidth;
  if (free <= 0) return baseX;
  if (el.align === 'center') return baseX + Math.floor(free / 2);
  return baseX + free;
}

// ─── Barcode command selector ────────────────────────────────────
//
// Each ZPL barcode type has its own command (^BC for Code 128, ^B3 for
// Code 39, ^BE for EAN-13, ^BU for UPC-A, ^BQ for QR).
// Height is supplied via ^BY (module width / ratio / height) before the
// barcode command. ^FO positions, ^FD is the data payload, ^FS ends.

function renderBarcode(el: LabelElement, data: LabelData, dpi: number): string[] {
  const sku = asciiSanitize(data.sku);
  if (!sku) return [];
  const x = mmToDots(el.xMm, dpi);
  const y = mmToDots(el.yMm, dpi);
  const heightDots = Math.max(20, mmToDots(el.barcodeHeightMm ?? 10, dpi));
  const showText = el.showBarcodeText === false ? 'N' : 'Y';
  const type: BarcodeType = el.barcodeType ?? 'code128';

  // ^BY module_width,wide_bar_ratio,bar_height
  // We use module_width=2 dots and wide:narrow ratio=3.0 — standard.
  const by = `^BY2,3,${heightDots}`;
  const fo = `^FO${x},${y}`;
  const fd = `^FD${sku}^FS`;

  switch (type) {
    case 'code39':
      // ^B3o,e,h,f,g
      return [`${by}${fo}^B3N,N,${heightDots},${showText},N${fd}`];
    case 'ean13':
      // ^BEo,h,f,g
      return [`${by}${fo}^BEN,${heightDots},${showText},N${fd}`];
    case 'ean8':
      return [`${by}${fo}^B8N,${heightDots},${showText},N${fd}`];
    case 'upca':
      return [`${by}${fo}^BUN,${heightDots},${showText},N,N${fd}`];
    case 'qr': {
      // ^BQa,b,c,d,e — model 2, magnification ~5, H error correction.
      return [`${fo}^BQN,2,5,H,0^FDHM,A${sku}^FS`];
    }
    case 'code128':
    default:
      // ^BCo,h,f,g,e,m — Y = print human readable, N = above barcode, N = no check digit, N = no mode
      return [`${by}${fo}^BCN,${heightDots},${showText},N,N,A${fd}`];
  }
}

// ─── Text element ────────────────────────────────────────────────

function renderText(el: LabelElement, data: LabelData, dpi: number): string[] {
  const raw = resolveElementText(el, data);
  if (!raw) return [];
  const text = asciiSanitize(raw);
  if (!text) return [];

  const fontSizePt = el.fontSizePt ?? 12;
  const heightDots = fontHeightDots(fontSizePt, dpi);
  const widthDots = estimatedCharWidthDots(heightDots);
  const x = alignedXDots(el, text, heightDots, dpi);
  const y = mmToDots(el.yMm, dpi);

  // ^CF sets default font then ^A0 sets scalable font for next field.
  // Syntax: ^A0N,height,width  (N = normal orientation)
  // ^FB provides a block for alignment: ^FBwidth,lines,space,align,indent
  const out: string[] = [];
  const fontCmd = `^A0N,${heightDots},${widthDots}`;

  if (el.widthMm && el.align && el.align !== 'left') {
    // Use ^FB for reliable alignment within a width box.
    const boxDots = mmToDots(el.widthMm, dpi);
    const zAlign = el.align === 'center' ? 'C' : 'R';
    out.push(
      `^FO${mmToDots(el.xMm, dpi)},${y}${fontCmd}^FB${boxDots},1,0,${zAlign},0^FD${text}^FS`
    );
  } else {
    out.push(`^FO${x},${y}${fontCmd}^FD${text}^FS`);
  }

  // Bold emulation: draw the same string 1 dot to the right (same trick as TSPL).
  if (el.weight === 'bold') {
    out.push(`^FO${x + 1},${y}${fontCmd}^FD${text}^FS`);
  }

  // Underline: ^GB (graphic box) as a thin filled rectangle under the text.
  if (el.underline) {
    const textWidth = text.length * widthDots;
    const underlineY = y + heightDots + 2;
    out.push(`^FO${x},${underlineY}^GB${textWidth},2,2^FS`);
  }

  return out;
}

function renderElement(
  el: LabelElement,
  data: LabelData,
  dpi: number
): string[] {
  if (el.visible === false) return [];
  if (el.type === 'barcode') return renderBarcode(el, data, dpi);
  return renderText(el, data, dpi);
}

function renderOneLabel(
  template: LabelTemplate,
  item: LabelData,
  dpi: number
): string {
  const copies = Math.max(1, Math.min(item.copies ?? 1, 99));
  const widthDots = mmToDots(template.widthMm, dpi);
  const heightDots = mmToDots(template.heightMm, dpi);

  const lines: string[] = [
    '^XA',                          // start of label
    `^PW${widthDots}`,              // print width in dots
    `^LL${heightDots}`,             // label length in dots
    '^LH0,0',                       // label home
    `^MD${Math.max(0, Math.min(30, template.density))}`, // density -30..30 (we accept 0-15 and pass through)
    `^PR${Math.max(1, Math.min(14, template.speed))}`,   // print rate
    '^CI28',                        // UTF-8 encoding (future-proof though we ASCII-sanitize for now)
  ];

  for (const el of template.elements) {
    lines.push(...renderElement(el, item, dpi));
  }

  lines.push(`^PQ${copies},0,1,Y`);  // print quantity
  lines.push('^XZ');                 // end of label
  return lines.join('\n') + '\n';
}

// ─── Driver singleton ────────────────────────────────────────────

class ZplDriver implements Driver {
  readonly name = 'zpl';
  readonly displayName = 'ZPL II (Zebra GK/GX/ZD/ZT, Honeywell PC42T)';

  readonly capabilities: DriverCapabilities = {
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
    unicode: false, // ^CI28 enables UTF-8 but we ASCII-sanitize for portability
    nativeBold: false,
    densityRange: [0, 15],
    speedRange: [1, 14],
  };

  async render(
    template: LabelTemplate,
    items: LabelData[],
    ctx: RenderContext
  ): Promise<DriverOutput> {
    const body = items
      .map((item) => renderOneLabel(template, item, ctx.dpi))
      .join('');
    const bytes = Buffer.from(body, 'binary');
    return {
      bytes,
      contentType: 'application/x-zpl',
      summary: `${bytes.length} ZPL bytes, ${items.length} label(s)`,
    };
  }
}

registerDriver(new ZplDriver());
