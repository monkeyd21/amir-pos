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
 * TSPL / TSPL2 driver.
 *
 * Covers: TVS LP 46 Neo/Lite/Pro, TVS LP 45, TSC TTP-244 family,
 * Xprinter XP-365B/XP-470B, Zenpert 4T200, Godex G500, Rongta RP400,
 * Munbyn TSPL models, and most generic Chinese 2-inch thermal label
 * printers.
 *
 * TVS LP 46 notes: confirmed TSPL2 compliant. Default density 8 and
 * speed 4 are sane for thermal transfer ribbon on most label stocks.
 * The printer resets to its saved settings on power cycle so we emit
 * DENSITY/SPEED on every batch to keep output consistent across POS
 * reboots.
 */

// ─── IR → TSPL font mapping ──────────────────────────────────────
//
// TSPL internal bitmap fonts (xScale = yScale = 1) at 203 DPI:
//
//   Font  Char width  Char height   Approx pt (@203 DPI)
//   1     8 dots       12 dots       ~ 4.3 pt
//   2     12 dots      20 dots       ~ 7.2 pt
//   3     16 dots      24 dots       ~ 8.6 pt
//   4     24 dots      32 dots       ~11.5 pt
//   5     32 dots      48 dots       ~17.3 pt
//
// At 203 DPI: 1 pt ≈ 2.82 dots, so char height in pt = dots / 2.82.
// We pick the largest font whose native point size is <= requested,
// and scale up via TSPL's xScale/yScale multipliers for anything larger.
//
// This means our "fontSizePt" is honoured within ~10-15% visually, which
// is plenty for retail price tags. Designs that rely on precise typography
// should use the PDF driver instead.

interface TsplFont {
  fontId: 1 | 2 | 3 | 4 | 5;
  charWidthDots: number;
  charHeightDots: number;
}

const TSPL_FONTS: TsplFont[] = [
  { fontId: 1, charWidthDots: 8, charHeightDots: 12 },
  { fontId: 2, charWidthDots: 12, charHeightDots: 20 },
  { fontId: 3, charWidthDots: 16, charHeightDots: 24 },
  { fontId: 4, charWidthDots: 24, charHeightDots: 32 },
  { fontId: 5, charWidthDots: 32, charHeightDots: 48 },
];

interface ResolvedFont {
  font: TsplFont;
  xScale: number;
  yScale: number;
  charWidthDots: number;
  charHeightDots: number;
}

function resolveFont(fontSizePt: number, dpi: number): ResolvedFont {
  const dotsPerMm = dpi / 25.4;
  // 1 pt = 0.3528 mm → target char height in dots:
  const targetHeightDots = fontSizePt * 0.3528 * dotsPerMm;

  // Find the TSPL font whose native height is <= target but closest.
  let chosen = TSPL_FONTS[0];
  for (const f of TSPL_FONTS) {
    if (f.charHeightDots <= targetHeightDots) chosen = f;
  }

  // If target is larger than the biggest native font, scale up.
  let scale = 1;
  if (targetHeightDots > chosen.charHeightDots * 1.25) {
    scale = Math.max(1, Math.min(10, Math.round(targetHeightDots / chosen.charHeightDots)));
  }

  return {
    font: chosen,
    xScale: scale,
    yScale: scale,
    charWidthDots: chosen.charWidthDots * scale,
    charHeightDots: chosen.charHeightDots * scale,
  };
}

// ─── IR → TSPL barcode mapping ────────────────────────────────────

function barcodeReadCode(type: BarcodeType | undefined): string {
  switch (type) {
    case 'code39':
      return '39';
    case 'ean13':
      return 'EAN13';
    case 'ean8':
      return 'EAN8';
    case 'upca':
      return 'UPCA';
    case 'qr':
      return 'QR';
    case 'code128':
    default:
      return '128';
  }
}

// ─── mm → dots helper ────────────────────────────────────────────

const mmToDots = (mm: number, dpi: number) => Math.round((mm * dpi) / 25.4);

// ─── Rendering ────────────────────────────────────────────────────

function alignedXDots(
  el: LabelElement,
  text: string,
  font: ResolvedFont,
  dpi: number
): number {
  const baseX = mmToDots(el.xMm, dpi);
  if (!el.widthMm || !el.align || el.align === 'left') return baseX;
  const boxWidthDots = mmToDots(el.widthMm, dpi);
  const textWidthDots = text.length * font.charWidthDots;
  const free = boxWidthDots - textWidthDots;
  if (free <= 0) return baseX;
  if (el.align === 'center') return baseX + Math.floor(free / 2);
  return baseX + free;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, maxChars);
  return text.slice(0, maxChars - 1) + '.';
}

function renderElement(
  el: LabelElement,
  data: LabelData,
  dpi: number
): string[] {
  if (el.visible === false) return [];

  // ── Barcode element ─────────────────────────────────────────
  if (el.type === 'barcode') {
    const sku = asciiSanitize(data.sku);
    if (!sku) return [];
    const x = mmToDots(el.xMm, dpi);
    const y = mmToDots(el.yMm, dpi);
    const heightDots = Math.max(20, mmToDots(el.barcodeHeightMm ?? 10, dpi));
    const readable = el.showBarcodeText === false ? 0 : 1;
    const code = barcodeReadCode(el.barcodeType);

    // QR uses QRCODE syntax, others use BARCODE
    if (code === 'QR') {
      // QRCODE x,y,ecc_level,cell_width,mode,rotation,"data"
      return [`QRCODE ${x},${y},H,4,A,0,"${sku}"`];
    }
    // BARCODE x,y,"type",height,human_readable,rotation,narrow,wide,"data"
    return [`BARCODE ${x},${y},"${code}",${heightDots},${readable},0,2,2,"${sku}"`];
  }

  // ── Text element ────────────────────────────────────────────
  const raw = resolveElementText(el, data);
  if (!raw) return [];

  const fontSizePt = el.fontSizePt ?? 12;
  const resolved = resolveFont(fontSizePt, dpi);
  let text = asciiSanitize(raw);

  // Truncate to fit bounding width if specified
  if (el.widthMm) {
    const boxWidthDots = mmToDots(el.widthMm, dpi);
    const maxChars = Math.max(1, Math.floor(boxWidthDots / resolved.charWidthDots));
    text = truncate(text, maxChars);
  }
  if (!text) return [];

  const x = alignedXDots(el, text, resolved, dpi);
  const y = mmToDots(el.yMm, dpi);

  // TEXT x,y,"font",rotation,xScale,yScale,"content"
  const out: string[] = [
    `TEXT ${x},${y},"${resolved.font.fontId}",0,${resolved.xScale},${resolved.yScale},"${text}"`,
  ];

  // Bold: TSPL bitmap fonts have no native bold — emulate via double-strike,
  // printing the same text one dot to the right.
  if (el.weight === 'bold') {
    out.push(
      `TEXT ${x + 1},${y},"${resolved.font.fontId}",0,${resolved.xScale},${resolved.yScale},"${text}"`
    );
  }

  // Underline: draw a BAR (filled rectangle) below the character cell.
  if (el.underline) {
    const textPixelWidth = text.length * resolved.charWidthDots;
    const barY = y + resolved.charHeightDots + 2;
    const barThickness = 2;
    out.push(`BAR ${x},${barY},${textPixelWidth},${barThickness}`);
  }

  return out;
}

function renderOneLabel(
  template: LabelTemplate,
  item: LabelData,
  dpi: number
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
    lines.push(...renderElement(el, item, dpi));
  }
  lines.push(`PRINT ${copies},1`);
  return lines.join('\n') + '\n';
}

// ─── Driver singleton ────────────────────────────────────────────

class TsplDriver implements Driver {
  readonly name = 'tspl';
  readonly displayName = 'TSPL / TSPL2 (TVS, TSC, Xprinter, Godex, Zenpert)';

  readonly capabilities: DriverCapabilities = {
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
    unicode: false,
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
      contentType: 'application/x-tspl',
      summary: `${bytes.length} TSPL bytes, ${items.length} label(s)`,
    };
  }
}

registerDriver(new TsplDriver());
